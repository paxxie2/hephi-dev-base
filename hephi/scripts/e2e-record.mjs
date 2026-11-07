#!/usr/bin/env node
// ROADMAP-95 A5：端到端验收记录脚手架（只生成记录，不执行验收、不访问宿主/GitHub）。
//
// 用途：为一次真实宿主 E2E 运行生成符合规范的 Markdown 记录骨架（A5 场景矩阵见
// hephi/docs/validation/e2e/README.md）。工具不执行检查、不创建 Issue/PR、不读写宿主；
// 它只校验参数并落盘模板，防止“先写通过结论、后补证据”。
//
// 用法：
//   node hephi/scripts/e2e-record.mjs --scenario E1-on --candidate-sha <40hex> \
//        --loaded-sha <40hex|unverified> --out hephi/docs/validation/e2e/2026-11-07-E1-on.md \
//        [--issue <n>] [--pr <n>] [--contract-hash sha256:<hex>] [--evidence <path>]... \
//        [--status pending|pass|fail|blocked]
//   node hephi/scripts/e2e-record.mjs --dry-run ...     # 只打印，不写文件
//   node hephi/scripts/e2e-record.mjs --self-test
//   node hephi/scripts/e2e-record.mjs --help
//
// 退出码：
//   0 = 记录已生成/自测通过/_dry-run 输出成功；
//   1 = 拒绝写“通过”（证据 < 3 条、实载 SHA=unverified、或 E9/E5 前置未满足）；
//   2 = 用法/参数/场景/文件错误（含场景不在白名单、SHA 格式错误、输出文件已存在）。
//
// 硬规则（防止伪通过）：
//   - --status pass 必须有 ≥3 条 --evidence，且 --loaded-sha 不能是 unverified；
//   - E9（后台检查）与 E5（检查中宿主中断）的前置未满足：即使凑齐证据也拒绝 pass，
//     原因见 README「E9/E5 前置与禁止声明」；
//   - “结论”字段永远写“待填写”，脚本不预填 pass。
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const SCENARIOS = [
  {
    id: 'E1-off',
    title: '对照组：同一任务卡不开赫菲（off）',
    group: 'baseline',
    prerequisites: '真实 Issue + 与 E1-on 逐字节相同的任务卡 + 不打 hephi/delivery、不挂载插件；B 线 off 组任务卡投递方案已批准（见 eval/RUNBOOK.md §4）。',
    order: ['创建 off Issue（同文任务卡）', '原生 Worker 实施', 'PR 创建（原生流程）', '核对无 HEPHI 合同/检查/决策日志'],
    entry: 'gh issue create --repo <repo> --title <title> --body-file <issue.md>（不打 hephi/delivery）；不创建 hephi 合同。',
    evidence: [
      'Issue URL/编号与任务卡 sha256',
      'PR 编号 + PR HEAD SHA + state',
      '无 `<state>/hephi/<ticketId>/activation.json`、`checks/`、`decisions.jsonl` 的检查输出',
    ],
    pass: '原生交付完成，且没有任何 HEPHI 合同/检查/决策日志（证明插件未干预）。',
    fail: '出现任何 HEPHI 合同/检查/决策记录（off 组被错误启用赫菲），或原生交付失败。',
    note: 'E1-off 是 A5 的对照组，不计入“赫菲场景通过数”，不得用它代替 E1-on。',
  },
  {
    id: 'E1-on',
    title: '正常修复（范围内改动）',
    group: 'core',
    prerequisites: 'A2/H1–H5 结论已记录（未验证时只能标 blocked/unverified）；候选构建与实载 SHA 回读可用（P0-4 流程）。',
    order: ['创建 Issue（hephi/delivery + 任务卡）', 'prepare 冻结合同', 'Worker 修改 + hephi_check', '推送并创建 PR', 'orchestrator_report(ready) 通过', '交付'],
    entry: '真实 Issue + `hephi/delivery` 标签；Worker：hephi_get_contract → 修改 → hephi_check → git push/gh pr create → orchestrator_report(state=ready, pr_number=N)。',
    evidence: [
      'Issue 编号/URL、Ticket、Worker Session id',
      'activation.json 的 contractHash/baseSha/allowedPaths',
      'run.json（status=passed, exitCode=0, sessionId/callId/innerCallId/finishedAt/前后指纹）与 output.log 的 sha256',
      'decisions.jsonl 中 ready 记录（rule=ready.pass）',
      'PR 编号、state=open、HEAD SHA == 被检查的 headCommit',
      '候选 SHA 与实载 SHA（decision log 的 pluginCommit 或 D4 回读记录）',
    ],
    pass: '检查 passed/exit 0；ready 通过；PR open 且 HEAD 与被验证 HEAD 一致；实载 SHA 可核验；无越界改动。',
    fail: '检查未 passed、ready 拒绝、PR HEAD 不一致、实载 SHA 不可核验、越界改动。',
    note: '',
  },
  {
    id: 'E8',
    title: 'Issue 缺任务卡',
    group: 'negative',
    prerequisites: '宿主 prepare 开启 HEPHI_REQUIRE_TASK=1（默认开启），且 task 卡校验逻辑为当前构建。',
    order: ['创建 Issue（hephi/delivery，但正文不含 hephi-task 任务卡）', '观察 prepare', '核对无合同'],
    entry: '创建不带 ```hephi-task``` 块的 Issue；触发 prepare。',
    evidence: ['Issue 编号', 'prepare 的拒绝输出/退出码', '确认没有生成 activation.json'],
    pass: 'prepare 拒绝，不创建合同（无 activation.json），不启动 Worker。',
    fail: 'prepare 成功或创建了合同。',
    note: '',
  },
  {
    id: 'E2',
    title: 'Worker 尝试编辑范围外文件（直接工具）',
    group: 'negative',
    prerequisites: '合同 allowedPaths 覆盖明确；edit/write 守卫按实际路径解析（A4）。',
    order: ['Issue 任务卡允许范围只含 src/**', 'Worker 用 edit/write 改范围外文件', '观察当场拒绝', 'Worker 改回或报 blocked'],
    entry: 'Worker 调用 edit/write 指向 allowedPaths 之外；预期 guard 当场拒绝。',
    evidence: ['拒绝消息/Session 事件（exec.agent 与 path）', '最终 git status/diff 无越界改动', 'run.json/ready 结果（如继续）', 'Ticket/Issue 回复状态'],
    pass: '越界编辑当场被拒；Worker 改回或报 blocked；最终无越界文件。',
    fail: '越界编辑被写入并进入最终 diff；或 ready 未拒绝越界证据。',
    note: '',
  },
  {
    id: 'E3',
    title: 'Worker 用 shell 写范围外文件并提交',
    group: 'negative',
    prerequisites: '最终 diff 校验与 ready 的 checkDiscipline 生效；项目检查不在 shell 内绕过。',
    order: ['任务卡范围为 src/**', 'Worker 用 bash 写范围外文件并 commit/push', 'hephi_check / ready 应拒绝', '核对证据与文档记录'],
    entry: 'bash 写 `outside/**` 并提交；随后 hephi_check + orchestrator_report(ready)。',
    evidence: ['shell 命令与 Session 事件', 'run.json 前后指纹/变更文件（含越界文件）', 'check/ready 的拒绝 reason 与 decisions.jsonl 记录', 'PR HEAD 与工作区状态'],
    pass: '检查或 ready 拒绝，拒绝理由明确指向范围外改动；不得进入交付。',
    fail: '越界 shell 改动被放行（检查或 ready 通过）。',
    note: 'E2 的守卫拦不住 shell；E3 验证最终 diff 兜底。',
  },
  {
    id: 'E4',
    title: '检查目录配置错误（check not started → 修正后重试）',
    group: 'recovery',
    prerequisites: '合同冻结检查的 cwd 校验（contained）；blocked 记录可保留、可重试新合同。',
    order: ['prepare 合同含错误 cwd 的检查', 'hephi_check → 记录 blocked（check not started:）', '修正检查配置并重新 prepare', '重跑检查成功', '核对历史 run.json 保留'],
    entry: 'HEPHI_VERIFICATION_FILE 中 check.cwd 指向不存在目录；hephi_check 后修正配置并重新 prepare。',
    evidence: ['首个 run.json（status=blocked，reason 前缀 check not started:）', '修正后的新合同 contractHash 与激活文件', '重试 run.json（passed）', '历史 run.json/output.log 未被改写/删除'],
    pass: '首次确定未启动记为 blocked；修正后新合同重试通过；历史证据原样保留。',
    fail: '错误被记成 passed/unknown；历史证据被覆盖/删除；无法重试。',
    note: '合同冻结检查配置，修正检查目录通常需要重新 prepare（新任务/新合同），不能就地改旧合同。',
  },
  {
    id: 'E5',
    title: '检查执行中宿主中断（A3 前后两段）',
    group: 'blocked-prereq',
    prerequisites: 'A3 已合并（resolutions.jsonl + runner 跳过 + hephi resolve）；但真实宿主中断/停机探针（H0）与 SQLite 停读方案未验证。',
    order: ['检查执行中让宿主中断/连接断开', '记录遗留 running/unknown', 'ready 应拒绝', '按 A3 由操作者 resolve 后重新检查', '核对旧记录不变、新检查通过'],
    entry: '检查运行中中断宿主（或模拟连接断开）；恢复后用 `hephi resolve --ticket <id> --run <runId> --basis host-terminal|operator-risk-accepted ...` 解除阻塞，再重跑检查。',
    evidence: ['中断前后宿主状态/进程记录', 'run.json（running/unknown）与 output.log', 'ready 拒绝 reason', 'resolutions.jsonl 记录（basis/hostQuery/operator/at）', '重跑检查记录与最终交付'],
    pass: '遗留执行被记为 running/unknown 且 ready 拒绝；经 A3 resolve 后可重新检查并通过；旧记录不被改写。',
    fail: '遗留执行被放行；resolve 被当作通过证据；旧记录被编辑；无法恢复。',
    note: '⚠️ 前置未满足：H0 停机/中断探针、H7 SQLite 停读方案、A3 真实宿主验证未完成 → 本场景当前禁止执行/禁止声称通过。',
  },
  {
    id: 'E6',
    title: 'ready 之后又提交了改动',
    group: 'negative',
    prerequisites: 'ready 证据粘滞在检查时的 HEAD/patch（before/after 指纹）。',
    order: ['完成检查与首次 ready', 'ready 之后追加提交/改工作区', '再次 ready 应拒绝过期证据'],
    entry: '首次 ready 通过后，在同一 Worker 追加 commit（或改动文件）再 orchestrator_report(ready)。',
    evidence: ['首次 ready 的 run.json/decisions 记录', '追加 commit 的 HEAD/diff', '第二次 ready 的拒绝 reason（stale evidence/source changed）', 'decisions.jsonl 对应记录'],
    pass: '第二次 ready 拒绝，理由为证据过期/源码变化；不得交付。',
    fail: '第二次 ready 仍通过（旧证据被复用）。',
    note: '',
  },
  {
    id: 'E7',
    title: 'PR HEAD 与本地不一致',
    group: 'negative',
    prerequisites: 'ready 使用 PR API 核对 state=open、baseRef、headSha。',
    order: ['Worker 完成检查', '创建/更新 PR 后再次推送改变 PR HEAD', 'ready 应拒绝 PR mismatch'],
    entry: 'ready 前在远端给同一 PR 追加 commit（或构造 HEAD 不一致）；orchestrator_report(ready, pr_number=N)。',
    evidence: ['PR 编号与远端 HEAD SHA', '本地被检查 HEAD/run.json before.headCommit', 'ready 拒绝 reason（PR/base/HEAD mismatch）与 decisions.jsonl'],
    pass: 'ready 拒绝且理由为 PR/base/HEAD mismatch。',
    fail: 'Head 不一致仍 ready 通过。',
    note: '',
  },
  {
    id: 'E9',
    title: '后台检查正常完成（Job 终态绑定）',
    group: 'blocked-prereq',
    prerequisites: 'A1-BIND 后台分支（promoted/background → jobs.get/readAt 终态与输出）；**H3 真实宿主探针**（jobs.get 错误 session 行为、readAt lossy）尚未验证。',
    order: ['长检查提升为后台 Job（或 run_in_background）', '等待 Job 完成', 'ready 通过并绑定 Job 终态/输出', '交付'],
    entry: '合同检查命令超过前台 timeout 被提升为 Job（promoteOnTimeout）或显式后台；ready 时 ctx.jobs 可用。',
    evidence: ['run.json 的 jobId/status/exitCode/outputHash', 'job 事件（job/registered、job/settled）与 Session 快照', 'H3 结论（jobs.get 终态/detail、错误 session、readAt lossy）', 'ready decisions 记录（job 绑定/输出校验）', 'PR/交付状态'],
    pass: 'ready 通过，且 Job 终态、detail 退出码、readAt 输出哈希全部核对通过。',
    fail: 'Job 终态/输出不可得却放行；readAt lossy 被忽略；绑定失败仍通过。',
    note: '⚠️ 前置未满足：H3 未在真实宿主验证（A2 历史快照对 H1/H2 已显示风险）→ 本场景当前禁止执行/禁止声称通过。',
  },
  {
    id: 'E10',
    title: '行为保持型重构任务',
    group: 'core',
    prerequisites: '任务卡验收项引用行为检查（kind=test）；项目检查能表达“行为保持”。',
    order: ['Issue 任务卡为行为保持型重构', 'prepare 冻结合同', 'Worker 重构 + hephi_check', 'PR + ready 通过', '交付'],
    entry: '真实 Issue（重构建任务卡）；检查命令覆盖重构前后行为等价性中可机械验证的部分。',
    evidence: ['Issue/task 卡与 contractHash', '重构前后测试/检查 output 与 run.json', 'PR HEAD 与被验证 HEAD 一致', 'ready decisions'],
    pass: '检查通过、ready 通过、PR 创建且绑定一致。',
    fail: '检查/ready 失败，或行为回归未被项目检查捕获。',
    note: '机制只证明合同检查通过；不能证明语义完全等价或没有未覆盖的行为漂移。',
  },
  {
    id: 'E-PR1',
    title: '首次创建 PR',
    group: 'core',
    prerequisites: 'requirePullRequest=1；ready 要求 pr_number 且 PR state=open/baseRef/headSha 匹配。',
    order: ['Worker 完成修改与检查', '首次创建 PR（无既有 PR）', 'orchestrator_report(ready, pr_number=N)', '交付'],
    entry: 'Worker 用 gh pr create（首次，无同分支既有 PR）创建 PR；随后 ready。',
    evidence: ['PR 首次创建事件/编号/URL/HEAD SHA/state/baseRef', 'run.json 的 before.headCommit', 'ready 通过记录', 'Issue 回复/交付状态'],
    pass: '首次 PR 创建成功；ready 核对的 pr_number/HEAD/base 全部一致并通过。',
    fail: '无法创建 PR、pr_number 缺失、PR state/HEAD/base 不一致仍通过。',
    note: '与 E7 的区别：E-PR1 验证首次创建流程；E7 验证 HEAD 不一致时拒绝。',
  },
]

const WHITELIST = new Set(SCENARIOS.map((scenario) => scenario.id))
const STATUSES = new Set(['pending', 'pass', 'fail', 'blocked'])
const REQUIRED_EVIDENCE_COUNT = 3
const BLOCKED_PREREQ = new Set(SCENARIOS.filter((scenario) => scenario.group === 'blocked-prereq').map((scenario) => scenario.id))
const LATEST_HOST_PROBE = 'H1–H5 未在真实宿主验证；A2 探针在历史快照上 H1/H2 为 FAIL（见 hephi/docs/validation/2026-11-07-evidence-chain-host.md §4）'

const USAGE = `ROADMAP-95 A5 端到端验收记录脚手架（不执行验收）

用法：
  node hephi/scripts/e2e-record.mjs --scenario <id> --candidate-sha <40hex> \\
    --loaded-sha <40hex|unverified> --out <file> \\
    [--issue <n>] [--pr <n>] [--contract-hash sha256:<hex>] [--evidence <path>]... \\
    [--status pending|pass|fail|blocked]
  node hephi/scripts/e2e-record.mjs --dry-run <同上参数>   # 只打印，不写文件
  node hephi/scripts/e2e-record.mjs --self-test
  node hephi/scripts/e2e-record.mjs --help

场景白名单：
  ${[...WHITELIST].join(' / ')}

硬规则：
  - --status pass 需要 ≥${REQUIRED_EVIDENCE_COUNT} 条 --evidence，且 --loaded-sha 不能是 unverified；
  - E9/E5 前置未满足（${[...BLOCKED_PREREQ].join('、')}）：即使有证据也拒绝 pass；
  - “结论”字段永远为“待填写”，脚本不会预填通过；
  - 默认 --status pending；记录路径规范：hephi/docs/validation/e2e/<date>-<scenario>.md。

退出码：0=成功/自测通过；1=拒绝写 pass；2=参数/场景/文件错误（含输出已存在）。
`

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}

function args(name) {
  const values = []
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}`) {
      const next = process.argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) values.push(next)
    }
  }
  return values
}

function fail(code, message) {
  console.error(`[e2e-record] ${message}`)
  process.exit(code)
}

function sha40(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
}

function contractHash(value) {
  if (typeof value !== 'string') return null
  return /^(?:sha256:)?[0-9a-f]{64}$/.test(value) ? value : null
}

function positiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function isoNow() {
  return new Date().toISOString()
}

function dateStamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function scenarioById(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null
}

function renderMarkdown({ scenario, candidateSha, loadedSha, issue, pr, hash, evidence, status }) {
  const lines = []
  lines.push(`# A5 E2E 验收记录 — ${scenario.id}（${scenario.title}）`)
  lines.push('')
  lines.push(`- 生成时间：${isoNow()}`)
  lines.push(`- 状态：\`${status}\``)
  lines.push('- 结论（人工填写，禁止预填 pass）：`待填写`')
  lines.push('')
  lines.push('> **假宿主/单测 ≠ E2E。** 本记录只对真实宿主、真实 Issue、真实 Worker、真实 PR 的一次运行负责；')
  lines.push('> 夹具测试、单元测试、静态推演均不得填入本记录作为 E2E 通过证据。')
  lines.push('')
  lines.push('## 1. 元信息')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 场景 | ${scenario.id} — ${scenario.title} |`)
  lines.push(`| 候选/构建 SHA | \`${candidateSha}\` |`)
  lines.push(`| 实载 SHA（回读） | \`${loadedSha}\`${loadedSha === 'unverified' ? '（unverified：不得据此声称通过）' : ''} |`)
  lines.push(`| Issue | ${issue ?? '待填写'} |`)
  lines.push(`| PR | ${pr ?? '待填写'} |`)
  lines.push(`| 合同哈希 | ${hash ?? '待填写'} |`)
  lines.push('| 宿主版本 / 来源 | 待填写（GET /orchestrator/api/state + 宿主包版本；versionSource=approved/experimental/unavailable） |')
  lines.push('| 宿主实例 / pid / 启动时间 | 待填写 |')
  lines.push('| Node / OS / pnpm | 待填写（验收口径 Node v22.19.0；本记录实际值） |')
  lines.push('| 运行模式 | 待填写（native/staged；enforce/shadow） |')
  lines.push('| Ticket / Worker Session id | 待填写 |')
  lines.push('| 证据目录 | 待填写（建议 `<state>/hephi/<ticketId>/` 与外部 evidence 目录副本） |')
  lines.push('')
  lines.push('## 2. 前置条件核对')
  lines.push('')
  lines.push(`- 前置（README 场景矩阵）：${scenario.prerequisites}`)
  lines.push('- 前置核对结论：`待填写`（未满足则本记录只能为 blocked）')
  lines.push('')
  lines.push('## 3. 执行顺序（检查 → 创建/更新 PR → ready → 交付）')
  lines.push('')
  lines.push('| # | 步骤 | 结果/命令与输出 | 证据指针 |')
  lines.push('| --- | --- | --- | --- |')
  scenario.order.forEach((step, index) => {
    lines.push(`| ${index + 1} | ${step} | 待填写 | 待填写 |`)
  })
  lines.push('')
  lines.push('## 4. 必须采集的证据')
  lines.push('')
  lines.push('### 4.1 场景要求（A5 矩阵）')
  lines.push('')
  for (const item of scenario.evidence) lines.push(`- [ ] ${item}`)
  lines.push('')
  lines.push('### 4.2 通用证据（所有场景）')
  lines.push('')
  for (const item of [
    'Issue 编号/URL、Ticket、Worker Session id',
    'activation.json（contractHash、baseSha、allowedPaths、evidence 策略）',
    'checks/<runId>/run.json 与 output.log（sha256、状态、前后指纹）',
    'decisions.jsonl（ready 规则/结果/pluginCommit 等）',
    'PR 编号、state、baseRef、HEAD SHA',
    '候选构建 SHA 与实载 SHA 回读证据',
    '最终 diff/工作区状态',
  ]) lines.push(`- [ ] ${item}`)
  lines.push('')
  lines.push('### 4.3 本记录已附证据（--evidence，≥3 条才允许 pass）')
  lines.push('')
  if (evidence.length === 0) {
    lines.push('- 待填写（至少 3 条，按路径/SHA/命令输出记录；本行不得删除）')
  } else {
    evidence.forEach((item, index) => lines.push(`- [${index + 1}] ${item}`))
  }
  lines.push('')
  lines.push('## 5. 通过 / 失败判定')
  lines.push('')
  lines.push(`- 通过条件：${scenario.pass}`)
  lines.push(`- 失败/blocked 判定：${scenario.fail}`)
  lines.push('- 本次判定：`待填写`（只允许 pass / fail / blocked；pass 必须与 §4、§6 证据一致）')
  if (scenario.note) {
    lines.push('')
    lines.push(`> 场景备注：${scenario.note}`)
  }
  lines.push('')
  lines.push('## 6. 版本流水线与实载回读（P2-7 / P0-4）')
  lines.push('')
  lines.push('- [ ] 记录本次运行中的**构建 SHA**（候选 SHA）；构建/部署与运行不是同一个提交时必须分别记录。')
  lines.push('- [ ] 实载 SHA 回读按 P0-4 序列：部署候选 → 启动/10 项健康 → 解除暂停 → 受控 smoke（标 SMOKE_ONLY）→ 读 decisions.jsonl 最后一条 `pluginCommit`（或启动日志行）→ 关闭 smoke Ticket → 再暂停；读不到就写 `unverified`，不得用磁盘哈希替代。')
  lines.push('- [ ] 任何新提交（代码/构建配置）都按 S1–S4 重新走对应阶段并重跑本场景；只改文档不重新部署。')
  lines.push('- [ ] 若通过 merge commit 合并到 main（P2-7），冒烟/验收对象必须是 merge commit 的构建，不是 PR head（或按计划对合并提交再冒烟）。')
  lines.push('')
  lines.push('## 7. 限制与声明')
  lines.push('')
  lines.push('- 假宿主/单测/模块 fixture 通过 **不等于** 本场景通过；E2E 只指真实宿主 + 真实 Issue/Worker/PR。')
  lines.push('- 实载 SHA 为 `unverified` 时不得把任何场景标 pass（脚本已强制拒绝）。')
  lines.push(`- 当前宿主证据链状态：${LATEST_HOST_PROBE}。H1–H5 未取得真实宿主结论前，E1/E9 等依赖绑定/Job 终态的场景不得声称通过。`)
  if (BLOCKED_PREREQ.has(scenario.id)) {
    lines.push(`- **${scenario.id} 前置未满足**：本场景当前禁止执行/禁止声称通过；只有前置探针（H3/H0/H7 等）通过并记录后才能解除。`)
  }
  lines.push('- 本记录不改变 R3.7 blocked / P8 部分完成的结论；也不单独构成 A5 完成判定（A5 需矩阵整体结论 + 负责人签收）。')
  lines.push('')
  lines.push('## 8. 附录：命令与原始输出（脱敏）')
  lines.push('')
  lines.push('```text')
  lines.push('待填写：记录执行命令、退出码与关键输出（脱敏：不写 token/凭据；路径可用 $HOME/<state>）。')
  lines.push('```')
  lines.push('')
  return `${lines.join('\n')}\n`
}

function validateAndRender(options) {
  const scenario = scenarioById(options.scenario)
  if (!scenario) fail(2, `场景不在白名单：${options.scenario ?? '(缺失)'}\n白名单：${[...WHITELIST].join(', ')}`)
  if (!sha40(options.candidateSha)) fail(2, '--candidate-sha 必须是 40 位小写十六进制 commit SHA')
  if (options.loadedSha !== 'unverified' && !sha40(options.loadedSha)) {
    fail(2, '--loaded-sha 必须是 40 位小写十六进制 commit SHA 或字面量 unverified')
  }
  if (!STATUSES.has(options.status)) fail(2, `--status 必须是 ${[...STATUSES].join('/')}`)
  if (options.issue !== null && positiveInt(options.issue) === null) fail(2, '--issue 必须是正整数')
  if (options.pr !== null && positiveInt(options.pr) === null) fail(2, '--pr 必须是正整数')
  if (options.contractHash !== null && contractHash(options.contractHash) === null) {
    fail(2, '--contract-hash 必须是 sha256:<64hex> 或 64hex')
  }

  if (options.status === 'pass') {
    if (options.evidence.length < REQUIRED_EVIDENCE_COUNT) {
      fail(1, `拒绝写“通过”：--evidence 至少 ${REQUIRED_EVIDENCE_COUNT} 条，当前 ${options.evidence.length} 条。请补真实证据后重试，不得先写结论后补。`)
    }
    if (options.loadedSha === 'unverified') {
      fail(1, '拒绝写“通过”：--loaded-sha 为 unverified（实载 commit 未回读）。按 P0-4 完成回读后重试；磁盘哈希不能替代实载 SHA。')
    }
    if (BLOCKED_PREREQ.has(scenario.id)) {
      fail(1, `拒绝写“通过”：${scenario.id} 前置未满足（${scenario.prerequisites}）。当前 ${LATEST_HOST_PROBE}；前置探针通过并记录前，本场景只能记 pending/blocked。`)
    }
  }
  return { scenario, markdown: renderMarkdown({ ...options, scenario, hash: options.contractHash }) }
}

function parseOptions(argv) {
  const scenario = arg('scenario')
  const candidateSha = arg('candidate-sha')
  const loadedSha = arg('loaded-sha')
  const out = arg('out')
  const issue = arg('issue')
  const pr = arg('pr')
  const hash = arg('contract-hash')
  const status = arg('status', 'pending')
  const evidence = args('evidence')
  return { scenario, candidateSha, loadedSha, out, issue, pr, contractHash: hash, status, evidence }
}

function runSelfTest(asJson) {
  const steps = []
  const record = (name, ok, detail) => steps.push({ name, ok: Boolean(ok), detail })
  const base = {
    candidateSha: 'a'.repeat(40),
    loadedSha: 'b'.repeat(40),
    evidence: ['evidence/a', 'evidence/b', 'evidence/c'],
    issue: '1',
    pr: '2',
    contractHash: `sha256:${'c'.repeat(64)}`,
  }
  // validateAndRender 使用 process.exit，自测通过子进程验证 CLI 行为。
  const cli = (args) => {
    const { execFileSync } = process.getBuiltinModule('node:child_process')
    try {
      const stdout = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--dry-run', ...args], {
        encoding: 'utf8', stdio: 'pipe',
      })
      return { status: 0, stdout }
    } catch (error) {
      return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
  }
  const execCli = (args) => {
    const { execFileSync } = process.getBuiltinModule('node:child_process')
    try {
      const stdout = execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', stdio: 'pipe' })
      return { status: 0, stdout }
    } catch (error) {
      return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
  }
  const dir = mkdtempSync(resolve(tmpdir(), 'e2e-record-self-'))
  const outFile = resolve(dir, 'record.md')
  try {
    const pending = cli(['--scenario', 'E1-on', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--out', outFile])
    record('pending 骨架生成（dry-run）', pending.status === 0 && pending.stdout.includes('状态：`pending`') && pending.stdout.includes('结论（人工填写，禁止预填 pass）：`待填写`'), `exit=${pending.status}`)
    record('dry-run 不写文件', !existsSync(outFile), outFile)

    const badScenario = cli(['--scenario', 'E999', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--out', outFile])
    record('非法场景 → exit 2', badScenario.status === 2, `exit=${badScenario.status}`)
    const badSha = cli(['--scenario', 'E1-on', '--candidate-sha', 'abc', '--loaded-sha', base.loadedSha, '--out', outFile])
    record('非法候选 SHA → exit 2', badSha.status === 2, `exit=${badSha.status}`)
    const passNoEvidence = cli(['--scenario', 'E1-on', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--status', 'pass', '--out', outFile])
    record('pass 无证据 → exit 1', passNoEvidence.status === 1, `exit=${passNoEvidence.status}`)
    const passUnverified = cli(['--scenario', 'E1-on', '--candidate-sha', base.candidateSha, '--loaded-sha', 'unverified', '--status', 'pass', '--evidence', 'a', '--evidence', 'b', '--evidence', 'c', '--out', outFile])
    record('pass + loaded-sha=unverified → exit 1', passUnverified.status === 1, `exit=${passUnverified.status}`)
    const passE9 = cli(['--scenario', 'E9', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--status', 'pass', '--evidence', 'a', '--evidence', 'b', '--evidence', 'c', '--out', outFile])
    record('E9 前置未满足 + pass → exit 1', passE9.status === 1, `exit=${passE9.status}`)
    const passE5 = cli(['--scenario', 'E5', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--status', 'pass', '--evidence', 'a', '--evidence', 'b', '--evidence', 'c', '--out', outFile])
    record('E5 前置未满足 + pass → exit 1', passE5.status === 1, `exit=${passE5.status}`)
    const validPass = cli(['--scenario', 'E1-on', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--status', 'pass', '--issue', '1', '--pr', '2', '--contract-hash', base.contractHash, '--evidence', 'a', '--evidence', 'b', '--evidence', 'c', '--out', outFile])
    record('合法 pass（3 证据 + 实载 SHA）→ exit 0 且不预填结论', validPass.status === 0 && validPass.stdout.includes('状态：`pass`') && validPass.stdout.includes('结论（人工填写，禁止预填 pass）：`待填写`'), `exit=${validPass.status}`)
    const validBlocked = cli(['--scenario', 'E9', '--candidate-sha', base.candidateSha, '--loaded-sha', 'unverified', '--status', 'blocked', '--out', outFile])
    record('E9 记 blocked（前置未满足）→ exit 0', validBlocked.status === 0, `exit=${validBlocked.status}`)

    const writeFile = resolve(dir, 'written.md')
    const firstWrite = execCli(['--scenario', 'E1-on', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--out', writeFile])
    record('真实写文件成功（非 dry-run）', firstWrite.status === 0 && existsSync(writeFile), `exit=${firstWrite.status}`)
    const secondWrite = execCli(['--scenario', 'E1-on', '--candidate-sha', base.candidateSha, '--loaded-sha', base.loadedSha, '--out', writeFile])
    record('输出已存在 → 拒绝覆盖（exit 2）', secondWrite.status === 2, `exit=${secondWrite.status}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const ok = steps.every((step) => step.ok)
  if (asJson) console.log(JSON.stringify({ selfTest: ok, steps }, null, 2))
  else {
    for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name} :: ${step.detail}`)
    console.log(ok ? 'SELF-TEST: PASS' : 'SELF-TEST: FAIL')
  }
  return ok
}

function main() {
  if (hasFlag('help')) {
    console.log(USAGE)
    return 0
  }
  if (hasFlag('self-test')) return runSelfTest(hasFlag('json')) ? 0 : 1

  const options = parseOptions()
  if (!options.scenario) fail(2, '缺少 --scenario')
  if (!options.candidateSha) fail(2, '缺少 --candidate-sha')
  if (!options.loadedSha) fail(2, '缺少 --loaded-sha')
  if (!options.out && !hasFlag('dry-run')) fail(2, '缺少 --out（或用 --dry-run 只打印）')

  const { markdown } = validateAndRender(options)
  if (hasFlag('dry-run')) {
    process.stdout.write(markdown)
    return 0
  }
  const out = resolve(options.out)
  if (existsSync(out)) {
    fail(2, `输出文件已存在，拒绝覆盖（验收记录不可覆盖）：${out}；请换文件名（规范 e2e/<date>-<scenario>.md）或先在 Git 中归档旧记录`)
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, markdown, 'utf8')
  console.log(`[e2e-record] 已写入 ${out}（scenario=${options.scenario} status=${options.status}）`)
  return 0
}

process.exitCode = main()
