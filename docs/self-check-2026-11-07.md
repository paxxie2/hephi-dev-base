# 自检报告（2026-11-07）

范围：本仓库相对 `718087c` 的全部新增/修改（39 个源/测试/脚本/文档文件，约 +1.8k 行），对照资料包
`implementation-checklist.md`、`validation-matrix.md` 与 `task-tree.yaml`。

> **状态指针（R4 同步，2026-11-07 06:54，R3 提交后；07:37 追加 R3 复核返修）**：本文是**初次自检时点**的记录；其中 L6、L7 已在后续提交修复（`bc95bf3`、`e862cf7`），L4 的不可变发布/自动回滚/全量健康门禁已由 R3 提交 `0d58bc3` 实现，但**原实现已被 PR #20 独立复核判定 R3 不通过（R3-F1–F6）**，返修已提交为 `2409613`（07:57 更新）（父 `17d3827`），补 N1–N5 负例后假宿主套件 **69 断言全绿**（旧提交上 PASS 50 / FAIL 19，双向实测）；假宿主验证通过也**不等于**真实宿主验收（R3.7 与实载回读仍未验证）。改后 `pnpm test` 实测 **20 文件 / 202 tests**（`deploy-script.test.ts` 约 `85.7s`，因假宿主门禁等待变长属预期；不新增测试文件）；`pnpm check` 的构建段须在 docs 提交后的干净树复跑（`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`））。历史 176→202 的时点链保留。当前状态以 [`docs/implementation-index.md`](implementation-index.md) §6 的修复索引为准（本轮修复分支已由 PR #20 合并为 `main@bc3386c`）；逐条命令与未验证项见 [`docs/remediation-r1-validation.md`](remediation-r1-validation.md)、[`docs/remediation-r3-validation.md`](remediation-r3-validation.md)、[`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §9。历史数字保留原时点，不回改。

方法：静态审阅、`pnpm check`（typecheck + 176 tests + 构建）、`test:unit`/`test:integration` 分层运行、
脚本正反例实跑、与验收矩阵逐条对照。所有结论附可复核命令。

## 1. 代码检查

- 结构：新增 `src/version.ts`、`src/control/decision-log.ts`；修改 `activation.ts`、`worker-mount.ts`、
  `evidence-verifier.ts`、`check-runner.ts`、`check-store.ts`、`index.ts`、`tsdown.config.ts`；
  13 个 planned 命令脚本 + 7 个 eval 脚本 + 文档。无 `TODO/FIXME`，仓库未配置 lint（仅 tsc + tests）。
- 静态检查：全部 `.mjs` `node --check` 通过；全部 `.sh` `sh -n` 通过。

### 1.1 本次自检发现并已修复的缺陷

| # | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| S1 | shadow 模式下合同在挂载后不可读/被改写时，ready 被拒绝 | 违反 P4“shadow 一律放行、只观察”的语义 | `ready-gate.ts` 新增 `allowUnavailable`，`worker-mount.ts` 在 shadow 传入；新增测试覆盖 |
| S2 | `eval/check-data-package.mjs` 遇到符号链接自环时 `ELOOP` 未捕获并崩溃 | 数据包预检在异常目录上不可控 | 改用 `lstatSync`，符号链接记为 `symlink` finding，不再递归；复测自环目录 EXIT=1 |
| S3 | `eval/export-baseline.mjs` 数据库路径不存在时抛栈 | 错误不可读、退出码不可预期 | 捕获并明确报错退出 2；复测 EXIT=2 |

### 1.2 限制清单（发现时点与后续状态）

| # | 限制（发现时点） | 说明 | 后续状态（R4 追记，2026-11-07） |
| --- | --- | --- | --- |
| L1 | 决策日志只做进程内串行 | 跨进程并发追加时 `seq` 可能重复（未加文件锁）；文档已标注 | **仍未修复**：P3 仍为部分完成 |
| L2 | 决策日志写失败仅写 stderr | 计划要求的“工具结果/独立告警通道”依赖 G1 新增项，尚未确认可用 | **仍未修复**：依赖 G1 未确认 |
| L3 | P2 legacy 合同例外 | 无 `plugin` 字段的旧合同不因构建不同被拒绝（其检查记录仍须为当前构建）；文档已标注，需人工确认口径 | **仍未修复**：仍需负责人确认口径 |
| L4 | 部署无不可变构建与自动回滚 | P8 只实现“构建→重启→回读→恢复”，回滚/竞态未实现 | **已实现但被复核判定不通过 → 已返修（假宿主验证）**：不可变发布 `releases/<sha>/lib`、原子指针切换、自动回滚、全量健康门禁、target/previous 与 `--host-version` 由 R3 `0d58bc3` 实现；PR #20 独立复核认定 R3 **不通过**（R3-F1 普通 `lib/` 迁移 EISDIR、F2 rollback 隐式 HEAD、F3 无恢复却记 restored、F4 恢复 rename 失败绕过双失败、F5 paused 硬编码 true、F6 current 校验被忽略）。返修提交 `2409613` 修复 F1–F6 并补 N1–N5：假宿主套件 **69 断言全绿**，旧提交上 **PASS 50 / FAIL 19**（双向实测）；**实载 commit 回读仍未验证**（见 L5），**P8 真实宿主验收未 done** |
| L5 | 实载插件 commit 无回读入口 | 宿主无版本查询 API，`describePlugin` 无调用入口 | **仍未修复**：R3 完成磁盘切换测试也不能替代实载回读 |
| L6 | `rebuild-isolated.sh` 仅 macOS | 使用 BSD `sed -i ''` | **已修复**：`bc95bf3`（P10 提交）改为临时文件可移植改写，并复测实例脚手架路径/端口 |
| L7 | eval/scripts 无自动化测试 | 仅人工正反例证据；未纳入任何 CI（按用户决定也不使用 Actions） | **已修复**：`e862cf7` 新增 `hephi/tests/eval/cli.test.ts`（4 用例，纳入 integration 分层，见 S6） |
| L8 | P4 super-agent 表面未改 | Worker 工具白名单/Skill 挂载面在本仓库之外，三组真实对照未做 | **仍未修复**：仓库外改动，未获授权 |

## 2. 实施清单对照（21 节点）

| 节点 | 实施 | 验收 | 说明 |
| --- | --- | --- | --- |
| G1 宿主能力确认 | 探针脚本（状态回读） | 未完成 | 11 项 + 3 项需真实 Worker/牺牲 Session；版本回读判“不具备” |
| G2 代码基线定版 | 完成 | 完成（Agent 代办） | PR #7 合并、`hephi-baseline-1` 指 `3f276a5`、八项逐项审查；**缺人类独立审查签名** |
| P1 持续集成 | 不实施（用户决定） | 不适用 | workflow 已删除 |
| P2 版本可追溯 | 完成 | 部分 | 注入/合同/记录/ready 拒绝已实现并测试；宿主版本必填未做 |
| P3 决策日志 | 完成 | 部分 | write/check/ready 记录已实现；跨进程与真实告警通道未验证 |
| P4 影子模式 | hephi 侧完成 | 部分 | 冻结合同/放行/观察已实现并测试；super-agent 表面与三组对照缺 |
| P5 版本化 | activation 完成 | 部分 | activation v1 + 严格解析；活跃工单禁止升级未实现 |
| P6 测试分层 | 完成 | 部分 | 分层真实（unit 无 git 调用）；性能门槛未定义 |
| P7 专用测试宿主 | 脚手架脚本 | 未完成 | 无干净机器/独立操作者 |
| P8 部署与回滚 | 脚本 + 一次真实部署 | 部分 | 真实重启链路已证；回滚/竞态/实载回读缺 |
| P9 实验仓库与凭据 | 未实施 | 未完成 | 仅只读权限检查 |
| P10 Dubbo 构建环境 | 未实施 | 未完成 | 无 Dubbo 检查配置/三候选任务 |
| P11 原生入口 | 验证完成（smoke） | 部分 | Issue→Ticket→Worker→PR 真实；hephi 激活型被基线缺陷阻塞 |
| P12 人员与职责 | 校验脚本 | 未完成 | 无真人数据与 κ |
| P13 预算 | 预检脚本 | 未完成 | 无真实账单/批准 |
| P14 数据合规 | 预检脚本 | 未完成 | 无真实数据包/负责人确认 |
| P15 历史基线 | 导出/校验 + 首次归档 | 部分 | 60 条唯一 Ticket（目标 ≥100 未达）；trigger 关联表未导出 |
| P16 一致性 | 完成（除 Skill） | 部分 | Skill 修改待专项批准 |
| GATE-B5-SMOKE / PILOT / FORMAL | 未开始 | 未完成 | 硬依赖未全部 done |

## 3. 测试用例检查

- 全量：17 个文件 / **176 tests**，全部通过；相对基线 `a212d69`（155）新增 21 个用例。
- 时点说明（R4 追记，R3 提交后更新）：上面 176／17 文件与下面的 41／135 分层均为**初次自检时点**。后经 S6/S7 补遗为 18 文件 / 180；R1 后 18 / 192；R1+R2 后 19 / 201；**R3（`0d58bc3`）后当前为 20 文件 / 202 tests**（2026-11-07 06:51:38，52.15s；Node `v22.19.0`、pnpm `11.7.0`；新增 `deploy-script.test.ts` 1 用例）。
- 分层：`test:unit` 7 文件 / 41 tests（实测无 git 调用）；`test:integration` 10 文件 / 135 tests（依赖真实 git）。
- 弱断言：仅 4 处既有用例使用 `toBeTruthy`（stage-control/worker-mount 既有场景），本次新增用例未引入弱断言。
- 覆盖缺口：eval 脚本 7 个、13 个 planned 命令脚本均无自动化测试；P2 构建注入、P3 跨进程、P4 三组对照、
  P5 活跃工单升级、P8 回滚/竞态、P9/P10/P12/P13 的真实场景未覆盖（见限制清单）。

## 4. 验收矩阵对照（62 场景）

| 节点 | 已覆盖 | 部分 | 未覆盖 | 不适用 |
| --- | --- | --- | --- | --- |
| G1 | 0 | 1 | 5 | 0 |
| G2 | 5 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 | 3 |
| P2 | 2 | 1 | 1 | 0 |
| P3 | 1 | 2 | 0 | 0 |
| P4 | 2 | 1 | 2 | 0 |
| P5 | 3 | 0 | 1 | 0 |
| P6 | 1 | 0 | 1 | 0 |
| P7 | 0 | 0 | 2 | 0 |
| P8 | 0 | 2 | 2 | 0 |
| P9 | 0 | 1 | 2 | 0 |
| P10 | 0 | 0 | 3 | 0 |
| P11 | 1 | 0 | 1 | 0 |
| P12 | 0 | 1 | 2 | 0 |
| P13 | 0 | 1 | 1 | 0 |
| P14 | 0 | 1 | 2 | 0 |
| P15 | 1 | 3 | 0 | 0 |
| P16 | 1 | 0 | 0 | 0 |
| GATE-B5 | 0 | 0 | 3 | 0 |
| **合计** | **17** | **14** | **28** | **3** |

已覆盖集中在 G2（5）与 P5（3）；未覆盖集中在 G1 真机探针、P7/P9/P10/P12/P13 外部资源项与三个 B5 门槛。

## 4.1 补遗（同日后续修复）

| # | 补充 | 证据 |
| --- | --- | --- |
| S4 | `eval/check-baseline.mjs` 对非法 JSON 会抛栈（关系表被篡改时） | 改为 `parseJson` 收集问题并继续；新增负例测试 |
| S5 | P15 关系表（Trigger/Disposition/Thread/Trigger↔Thread）未导出 | `eval/export-baseline.mjs` 增加关系表导出与 summary 计数；`check-baseline` 校验计数、source 内唯一性与引用；第二次真实归档 r2 通过 |
| S6 | eval/scripts 无自动化测试（原 L7） | 新增 `hephi/tests/eval/cli.test.ts`（4 用例，覆盖 kappa、基线与关系表、roles/budget/data-package、shadow-parity/dubbo 运行器），纳入 integration 层 |
| S7 | P6 的测试分层文档实际未落盘（`a96dc1b` 只改了 `package.json`，README 未被修改；此前汇报有误） | 根 `README.md` 新增「测试分层（P6）」小节，记录 unit/integration 命令、覆盖与实测耗时（0.45s / 34s），并更新总数 180 |
| S8 | P8 无不可变构建/自动回滚（原 L4） | 部署脚本增加构建快照、`releases/<sha>/lib` 与 `--rollback`；在 B 实例完成“部署→回滚→再部署”三轮实测，入口 sha256 前后可对照 |
| S9 | P8 竞态场景未验证（原缺口） | 暂停期间创建 Issue 实测：Trigger 持久化、无 Ticket/Worker；恢复后只有 1 条 trigger、1 个 Ticket、1 个 worker 会话。另见 `docs/p8-race-record.md`：同主题多出的 PR 经复查**不能归因于调度或本 Worker**，来源未确认（已更正先前推断） |
| S10 | P5“有进行中工单时禁止升级”未实现 | 部署脚本增加进行中 Ticket 检查与 `--allow-open-tickets` 显式跳过；暂停状态下实测拒绝（3 个进行中 Ticket）与放行 |
| S11 | hephi 激活交付未做过真实 smoke（P11/B5 入口） | 合并基线修复 PR #29、使检查自包含后完成两轮：第一轮因 prepare/Worker 构建不一致被 `ready.plugin-build` 拒绝（fail-closed）；部署重启后第二轮完整通过（合同→hephi_check pass→ready.pass→PR #42）。**PR #42 已按用户指示合并到 site-pnl `main`（`8d2ec58`）**。记录见 `docs/p11-hephi-smoke-record.md` |
| — | 测试总数 | 176 → **180**（unit 41 / integration 139）；`pnpm check` 全绿 |

## 5. 结论

- 代码（**初次自检时点**）：176 tests 全绿、构建通过；自检发现 3 个缺陷（1 个行为语义、2 个健壮性）均已修复并复测。
- 代码（**当前时点，R3 提交后**）：20 文件 / **202 tests** 全绿（`pnpm test`，2026-11-07 06:51:38，52.15s；`pnpm typecheck` exit 0）；**Node `v22.19.0`、pnpm `11.7.0` 与方案指定一致**（R1/R2 时点曾在 Node `v26.1.0` 复跑，结果同为全绿）。`pnpm check` 的构建段仍须在最终提交的干净工作树复跑（R2 起 dirty 树直接拒绝构建），最终验收由 R5 独立复跑关闭。
- 实施：资料包 21 个节点中，6 个已完成实施（G2、P2、P3、P4、P5、P6 的代码/文档部分），
  P1 按用户决定不实施，其余受外部资源或仓库外改动阻塞；验收层面只有 G2 由 Agent 代办完成（缺人类签名）。**R1–R3 代码完成不会自动把 P2／P5／P8 改为真实验收 done**（见 §6）。
- 建议下一步：优先完成 R3 返修的二次独立复核（复核报告 §6 的 7 条门槛，见 §6.3），再补 P8 真实宿主验收（R3.7：A→B→A、实载回读、受控故障注入）与 P15 trigger 关联表；G1 真机探针与 P9–P13 需外部资源；
  P4 三组对照需要 super-agent 仓库与宿主导出。
- R3 复核结论（2026-11-07 追加）：原 R3 实现被 PR #20 独立复核判定 **不通过**（F1–F6）；返修提交 `2409613` 已关闭 F1–F6 并补 N1–N5（假宿主 69 断言全绿，旧提交 PASS 50 / FAIL 19）。**P8 仍为部分**：R3.7 真实宿主（A→B→A、实载回读、故障注入、真实 drain 语义）仍未验证；PR #20 已于 2026-11-07 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）。

## 6. 本轮修复追记（R4 同步，2026-11-07）

### 6.1 R1／R2／R3 提交与验证

| 工作包 | 提交 | 内容 | 验证（实测） | 局限 |
| --- | --- | --- | --- | --- |
| R1 | `9e874f8` | activation 升 `version: 2`，递归规范化哈希；v1／无版本走历史原始键序哈希只读兼容；未知版本先验 hash 再拒绝 | `activation.test.ts` 30 passed（含 R1-T01–T12）；R1-T12 期望值由独立 Python 实现复算一致；`pnpm typecheck` exit 0 | 独立会话复跑未做；v1/v2 合同字节样例未归档 |
| R2 | `0d7c031` | dirty（已跟踪／暂存／未跟踪）构建失败；有 `.git` 时以完整 HEAD 为唯一 commit；无 git 时 `HEPHI_BUILD_COMMIT` 必须是 40 位十六进制 | `build-commit.test.ts` 9 passed（R2-T01–T08 + 配置惰性）；真实 dirty 工作树 `pnpm build` exit 1 | 独立克隆 dirty 负例、无 git 源码归档路径未实测（未验证） |
| R3 | `0d58bc3` | 重写部署脚本：`--host-version` 必填、`git archive` 干净构建、不可变 `releases/<sha>`、原子 symlink 指针切换、10 项全量健康门禁、失败自动恢复 previous 并复检、drain 未知字段拒绝、无绕过入口 | 假宿主 R3-T01–T17 **PASS: 44 assertions**（`real 50.22s`／复核 `49.55s`）；`deploy-script.test.ts` 1 passed；全量 20 文件 / 202 tests（Node `v22.19.0`）。**独立复核判定 R3 不通过**：该 44 断言不覆盖 F1–F6 失败路径 | **R3.7 真实宿主 A→B→A、实载 commit 回读、真实 drain API 语义全部未验证**；独立复核未通过（request changes） |
| R3 返修 | `2409613` | 修复 R3-F1–F6：普通 `lib/` 目录迁移事务（先改名旧目录再切 symlink，第二步失败恢复旧目录）、rollback 强制显式 `--target`／`--previous` 完整 SHA、结果拆 `failed-no-previous`/`failed-restored-previous`/`failed-twice`、所有 `set_pointer` 失败捕获并写双失败记录、结束时真实回读 `paused`/`load`/`health`、`current_valid` 拆分 | 新增 N1／N1b／N2／N3／N4／N5 六组负例。**双向实测**：修复提交 **`PASS: 69 assertions`、FAIL 0、exit 0**（`real 84.23s`；主套 46 + 负例 23）；旧提交 `17d3827` → **PASS 50 / FAIL 19**（复跑一致） | 全量 `pnpm test` **20 文件 / 202 tests**（`deploy-script.test.ts` 约 `85.7s`）；假宿主通过 ≠ 真实宿主验收；F6 无专属动态负例；复核 §6 多条门槛仍部分；`pnpm check`（含构建）：`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） |

### 6.2 21 节点状态不变声明

- R1–R3 属于 P5／P2／P8 的实现层修复，不改变 §2 的验收口径：P2 仍为部分、P5 仍为部分、**P8 仍为部分**（R3 只完成假宿主验证，R3.7 真实宿主与实载回读未做，不得记 done）。**R3 返修也不改变该口径**。
- G1、G2 人类独立审查、P3、P4、P6–P15 与 GATE-B5 状态不变，仍按原门槛阻塞。
- 详细命令、退出码与未验证项见 [`docs/remediation-r1-validation.md`](remediation-r1-validation.md)、[`docs/remediation-r3-validation.md`](remediation-r3-validation.md)、[`docs/remediation-r3-validation.md`](remediation-r3-validation.md) §9。

### 6.3 R3 独立复核不通过与返修（2026-11-07 追加）

- **复核事实**：PR #20 独立复核（审查提交 `17d3827`，独立工作树复跑 + 隔离故障注入）判定 **R3 不通过**，列出 R3-F1–F6；原假宿主 44 断言全过，但 5 组独立负例全部复现缺陷，其中首次从普通 `lib/` 目录迁移直接阻断部署。R1／R2 代码层通过。**PR #20 不批准合并，不得进入 R3.7。**（报告在仓库外：`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/PR20-independent-review.md`）
- **返修事实**：返修提交 **`240961395ce0fb323683bab21830fbdc123257d8`**（父 `17d3827`）修复 F1–F6（普通目录迁移事务、rollback 显式 target、三态恢复结果、恢复失败捕获、真实 paused 回读、`current_valid` 拆分），并把复核要求的 N1–N5 纳入 `scripts/host/test-deploy-hephi.mjs` 的 `runNegativeSuite()`（另含 N1b 迁移第二步失败）。**双向实测**：修复提交 → **`PASS: 69 assertions`、FAIL 0、exit 0**（`real 84.23s`，主套 46 + 负例 23）；旧提交 `17d3827` → **exit 1、PASS 50 / FAIL 19**（复跑一致）；N1 复现 `EISDIR`，N4 在旧提交上是 `exit 0` + 写 `result:ok`（非裸 42），N5 旧脚本在真实 `paused=false` 时仍 exit 0 且记录硬编码 `paused:true`。改后全量 `pnpm test` 实测 **20 文件 / 202 tests**（`deploy-script.test.ts` 约 `85.7s`）；**`pnpm check` 的 typecheck+test+build 最终输出`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`）**。
- **边界不变**：假宿主（含返修负例）通过 **不等于** R3.7 真实宿主验收；实载 commit 回读、真实健康故障注入、真实 drain 语义仍 **unverified**；**P8 仍为部分**；**本次只关闭 R3-F1–F6 与 N1–N5 自动化；PR #20 已于 2026-11-07 合并为 `main@bc3386cd65fee16b1777294929389db5a710bb29`（PR #20）**；复核 §6 的重新送审门槛仍有多条未完全满足（见返修登记 §3.1），不得写成“已满足”。
- 历史失败记录（44 断言、F1–F6）原样保留，不回改、不删除。
