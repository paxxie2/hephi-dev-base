# HEPHI-R2 整改 + PR #20 复核返修 + R3.7 真实宿主尝试：交付资料（供其他模型分析）

生成时间：2026-11-07 09:45（Asia/Shanghai）
实现仓库：`/Users/zm/dsh-instances/experiment/hephi-review`（远端 `paxxie2/super-agent-hephi-review`）
相关文档：`HEPHI-R2-remediation-checklist.md`、`PR20-independent-review.md`（同目录）
说明：本文件只陈述可核对事实；不确定项标 **unverified**，不替读者下结论。

---

## 1. 一句话现状

- **R1/R2/R3 代码已实现**；R3 被独立复核判 **Request changes** 后完成 **R3-F1–F6 返修**并新增 **N1–N5 负例**，**双向实测通过**（旧提交失败、修复提交通过），PR #20 已合并进 `main`。
- **R3.7 真实宿主验收已尝试但 blocked**：真实排空 API 缺 5 个字段 → 新部署脚本按设计 fail-closed 拒绝；**未构建、未切换、未重启**。因此 **P8 仍为部分/unverified**。
- 过程中发现并纠正一次真实污染：**验证时 `pnpm check` 改写了实载插件目录的 `lib/`**，已从已部署 release 恢复并核对哈希。

---

## 2. 仓库、提交、PR 与标签

| 项 | 值 |
| --- | --- |
| 基线 | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（原 `main`，PR #19） |
| 当前 `main` | **`8fd199da1d2437ccc9da90a0cfcca64d1646549d`**（PR #22 合并提交）；PR #7–#22 已合并 |
| 标签 `hephi-baseline-1` | 内层 `3f276a533bceaa63f3e43ff8d0d1e75af9dac8c8`（**未移动**） |
| PR #20 | MERGED，merge commit **`bc3386c`**（R1–R3 + 返修 + 文档） |
| PR #21 | MERGED，`5b6fb6e`（记录 PR #20 合并状态的 docs） |
| PR #22 | MERGED，`8fd199d`（记录 R3.7 尝试 blocked 的 docs） |

提交链（`5efd708..8fd199d`，`git log --oneline` 实测）：

```
8fd199d Merge pull request #22
d965cb9 docs: record R3.7 real-host attempt on host B (blocked at drain gate)
5b6fb6e Merge pull request #21
c2865fe docs: record PR #20 merge into main (bc3386c)
bc3386c Merge pull request #20
fc4d193 docs: make merge-status statements time-point safe
7f50c13 docs: consolidate R3 review-fix record into allowed validation doc
4664e96 docs: record PR #20 independent review findings and R3 remediation
2409613 R3 remediation: fix F1-F6 from PR #20 independent review
17d3827 R4: sync docs with R1-R3 implementation and validation evidence
0d58bc3 R3: immutable releases, atomic pointer switch, full health gate with auto-rollback
0d7c031 R2: refuse dirty builds and require a full commit identity
9e874f8 R1: canonical activation hash for version 2, legacy read-only compatibility
```

范围：`git diff --name-only 5efd7084..8fd199d` = **16 个文件**（8 docs + 8 代码/测试/脚本），全部 ⊆ 冻结的 `plan.lock.json` `allowed_files`；9 个受保护文件 sha256 与基线一致。

---

## 3. 三块代码改动（评审重点）

### R1（`9e874f8`）：activation v2 规范化哈希
- `hephi/src/control/activation.ts`：`ACTIVATION_VERSION = 2`；新增 `canonicalize()`（递归排序对象 key，数组保序）与 `canonicalPayload()`，`contractHash()` 对规范化 JSON 求 sha256。
- 兼容：`version: 1` 或**无 version 字段**的旧合同走 `legacyPayload()`（原始 `JSON.stringify` 键序）只读读取；未知版本先验 hash 再拒绝。
- 测试：`activation.test.ts` 30 用例（含 R1-T01–T12）；R1-T12 期望值由独立 Python 实现复算一致（`sha256:14756a3e…c50`）。

### R2（`0d7c031`）：构建必须来自干净提交
- `hephi/tsdown.config.ts`：懒加载 `defineConfig()`，构建时 `resolveBuildCommit()`：
  - 有 `.git`：`git rev-parse HEAD` 取完整 SHA；`git status --porcelain`（含已跟踪/暂存/未跟踪）非空 → 抛 `refusing to build from a dirty working tree: …`；`HEPHI_BUILD_COMMIT` 不能覆盖 Git HEAD。
  - 无 `.git`：`HEPHI_BUILD_COMMIT` 必须是 40 位十六进制，否则拒绝。
- 测试：`build-commit.test.ts` 9 用例（R2-T01–T08 + 配置惰性）；真实 dirty 树 `pnpm build` exit 1。
- 副作用（实测多次）：把备份目录留在仓库内（未跟踪）就会触发该拒绝。

### R3（`0d58bc3` + 返修 `2409613`）：不可变部署 / 原子指针 / 全健康 / 自动回滚
`scripts/host/deploy-hephi.sh` 重写（头部含 11 条不变量注释）：
- 构建：`git archive <sha>` 到独立 `releases/<sha>/.build-*` 临时目录，`HEPHI_BUILD_COMMIT=<sha> pnpm install --frozen-lockfile && pnpm check`；不在实载 `lib` 上构建。
- 发布：`.incoming-<sha>-<pid>` → 校验 → 单次原子 `mv` 到 `releases/<sha>/`；已存在即拒绝（不可变）；`meta.json` 记 `formatVersion/pluginCommit/sourceTree/entrySha256/builtAt/buildCommand/hostVersion/source`。
- 指针：`$hephi/lib` 迁移为 symlink；**普通目录首迁是显式事务**：旧目录原子 `mv` 到 `$hephi/.migration-<UTC>-<pid>` → 再 rename 新 symlink；第二步失败恢复旧目录、非零退出、写 `failed-pointer`。
- 切换与健康：10 项显式健康门禁 `runtime relay notice launch delivery assessment reply evals models github`，`starting`/`error`/缺失/超时均失败；重启后失败自动恢复 previous（或首迁快照）并再次全量健康。
- 失败语义：`failed-no-previous` / `failed-restored-previous` / `failed-twice`；全部 `set_pointer` 调用 `if ! ...` 捕获，恢复 pointer/restart 失败写双失败记录（含 `targetFailure`、`restoreFailure`、`restoreHealth`）。
- 记录：`record()` 写盘前 `read_state`，保存真实 `paused`/`load`/`healthReadback`（读不到 `unverified`）；成功路径复核 `paused=true`，否则写 `failed-not-paused` 并非零退出。
- 参数：`--rollback` 必须有显式 `--target`（及可选完整 `--previous`），任何 HEAD 默认之前校验；`--host-version` 必填单行；drain 的 5 个未知字段缺失即 `unverified` 拒绝；open ticket > 0 拒绝；`--allow-open-tickets` 已删除（传入按未知参数 exit 2）。

---

## 4. PR #20 独立复核与返修（`PR20-independent-review.md`）

复核结论原文：**Request changes，R3 不通过**（R1/R2 代码层通过）。6 个缺陷与修复：

| 编号 | 原缺陷 | 修复后行为 | 负例 |
|---|---|---|---|
| F1 | 普通 `lib/` 目录首迁 `renameSync` → `EISDIR`，部署失败 | 迁移事务（先挪旧目录、失败恢复） | N1（成功+备份保留旧内容）、N1b（注入第 1 次 rename 失败→旧目录恢复+`failed-pointer` 记录） |
| F2 | `--rollback` 缺 `--target` 时隐式取 HEAD 并成功 | `target_set` 标记 + 任何默认前校验；缺/空/非法 SHA 均无副作用拒绝 | N2（5 断言，含指针/启动次数/记录数不变） |
| F3 | 未执行恢复却写 `failed-restored-previous` | 三态结果；恢复目标 = 显式 previous（已校验）否则 validated current；真恢复+健康通过才写 restored | N3 |
| F4 | 恢复 `set_pointer` 失败被 `set -e` 裸退出（负例注入 42） | 全部捕获，写 `failed-twice`（双段证据）后非零退出 | N4（PATH node 垫片让第 2 次 renameSync 失败） |
| F5 | `record()` 硬编码 `paused:true`；双失败无健康证据 | 真实回读 `paused/load/healthReadback`；非 paused 记 `failed-not-paused`；双失败保留两段证据 | N5（假宿主真实返回 `paused=false`） |
| F6 | `current` 校验结果被 `|| true` 吞掉，坏 current 可能当恢复目标 | 独立 `current_valid`，未通过校验不得恢复 | 无专属动态负例（静态保证，标 unverified-by-test） |

套件规模：`scripts/host/test-deploy-hephi.mjs` 重构为 `initWorld()/closeWorld()` 多世界；**69 断言** = 主套 46（原 44 + 2 条记录真实性）+ 负例 23（N1 4、N1b 3、N2 5、N3 4、N4 4、N5 3）。`hephi/tests/control/deploy-script.test.ts` 作为 vitest 入口，断言期望 69。

**调试中发现的一个重要 harness bug（值得评审关注）**：假宿主在 `start.sh` 真正执行前就报 `runtime=ready`，导致 deploy 返回时其 fork 的启动进程尚未 exec，测试随后改写 `start.sh` 会被「旧进程执行新脚本」，从而消耗 fail-once 标记、让 N4/N5 假通过/假失败。修复：假宿主在 `started.marker`（pauseOnStart 世界还要 `resumed.marker`）存在前一律报 `runtime=starting`。**这是测试夹具问题，不是产品脚本问题**；`deploy-hephi.sh` 在该轮调试中未被修改。

---

## 5. 双向验证与最终验收（全部真实执行）

环境：Node **v22.19.0** / pnpm **11.7.0**（nvm 安装，PATH 前置）。

| 方向/对象 | 命令 | 结果 |
|---|---|---|
| 旧提交 `17d3827` × 终版套件（独立克隆，旧 `deploy-hephi.sh` 保持 17d3827） | `node scripts/host/test-deploy-hephi.mjs` | **exit 1，PASS 50 / FAIL 19**（N1×4、N1b×1、N2×2、N3×3、N4×4、N5×3、R3-T17×1、R3-T08×1）；复跑 FAIL 集合一致。N1 有真实 `EISDIR` 栈；**N4 在旧脚本上实测 exit 0 且写 `result:"ok"`（不是复核静态推演的裸 42）**；N5 旧脚本在真实 `paused=false` 时仍 exit 0、记录硬编码 `paused:true` |
| 修复分支（干净树） | 同上 | **PASS: 69 assertions，exit 0**（Lead `real 84.23s`；独立验证者 83.15/83.35s） |
| 修复分支 | `cd hephi && pnpm check` | exit 0：20 文件 / 202 tests；tsdown 构建成功 |
| 最终 `main@8fd199d`（独立克隆） | `pnpm check` + 套件 + `git diff --check` | **check exit 0（20/202，Build complete 1564ms）；套件 69 断言 exit 0；diff-check 0**；`5efd708..8fd199d` = 16 文件 |

独立验证者（另一个 agent，独立克隆/只读）复核了 4 轮（`17d3827` 反向、`2409613`、`4664e96`、`7f50c13`），并与 Lead 实测交叉一致；还抓出一次**范围越界**：新增文档 `docs/remediation-r3-review-fix.md` 不在冻结 `allowed_files`，已把内容并入 allowed 的 `docs/remediation-r3-validation.md` §9 并删除该文件（最终 16 文件全部在范围内）。

---

## 6. R3.7 真实宿主尝试（2026-11-07，结果 **blocked**）

宿主 B：`http://127.0.0.1:3083`，pid `29031`，启动 2026-11-07 05:47:12，node v26.1.0 / dsh 0.2.1-rc.5。
实例：`/Users/zm/dsh-instances/experiment`；插件目录 `<instance>/hephi-review/hephi`（profile link）；`hephi/lib` 为**普通目录**；已部署 release `fba676e89e…`（entry `fe404c0d…`）。

| 步骤 | 真实输出/结果 |
|---|---|
| 暂停 | `POST /orchestrator/api/executor/pause {"paused":true}` → `{"paused":true}`；1s 内 `paused=true`，load `0/0`，10 项 health 全 ready |
| 排空检查 | `load` 只有 `running/queued/maxWorkers`；脚本输出 `unverified drain field: startupReservations; … effects; jobs; subagents; unknown` → `drain check failed; refusing to upgrade` |
| 部署尝试（dry-run，target `main@5b6fb6e`） | **exit 1**；**未构建、未切换指针、未重启**；副作用核对：host.pid 不变、releases 数 6、logs 数 8、`hephi/lib` 类型与树哈希不变 |
| 下一道门禁 | 真实存在 **2 个 open Ticket**：`b3a7d823bad0339e77dde1fb22f2060b`（person/answer）、`24983dd77e986b48866bb016a909d490`（person/failed）；即使排空通过也会拒绝（无绕过入口） |
| hostVersion | 无固定宿主版本快照定义；尝试只用实验性标识 `dsh-0.2.1-rc.5+composed-config-4b20291e9ba9`（dsh 版本 + `logs/composed-config.yml` sha256 前缀），**未采纳为正式语义** |
| 恢复派发 | `{"paused":false}` → 1s 内 `paused=false`、10 项 health 全 ready、load `0/0` |

**判定**：R3.7 第 3–5 项（真实 A→B→A、实载回读、可恢复故障注入与自动回滚）**未执行**；P8 保持 **unverified/部分**。
**解阻依赖（外部）**：① 宿主 `/orchestrator/api/state` 暴露 5 个排空字段（或负责人明确语义）；② 定义 `hostVersion` 固定来源；③ 关闭/完成 2 个 open Ticket。均不得用默认 0 或编造值绕过（checklist R3.5 明确要求）。

---

## 7. 额外发现：实载 lib 被验证构建污染（已纠正，值得评审分析）

- 实载插件目录（`<instance>/hephi-review/hephi`）**就是实现仓库工作树**；本轮多次在该目录跑 `pnpm check`，构建写入 `hephi/lib/`，而宿主进程 05:47 启动后未重启 → **磁盘 lib ≠ 已部署 release**（磁盘 entry `1b9fd4ec…` / 早前 `5ff4b59b…` vs release `fe404c0d…`）。
- 纠正：被重建的 lib 移到**仓库外** `experiment/evidence/live-lib-rebuilt-20261107T012623Z`（仓库外，保留审计；若留在仓库内会因未跟踪文件触发 R2 dirty 构建拒绝），再从 `releases/hephi/fba676e…/lib` 复制恢复。
- 恢复后核对：live `index.mjs` = `fe404c0d…`；live lib 树哈希 = release 树哈希 = snapshot 树哈希 = `10b49b7b…`；`lib` 仍普通目录；宿主 `paused=false`、10 项 health ready、load `0/0`；仓库工作树干净。
- 该事件印证：**文件哈希 ≠ 实载 commit**；宿主无实载回读入口时不能声称加载了哪个 commit。也说明「开发目录 = 实载目录」是当前布局的运维风险，建议解阻后按新脚本把实载迁为 `releases/<sha>/lib` 指针。

---

## 8. 已证明 / 未证明清单

**已证明（真实执行）**
- R1：规范化哈希 + 旧合同只读兼容（30 用例，含 T12 独立复算一致）。
- R2：dirty（含未跟踪）拒绝构建、无 git 需完整 SHA（单测 + 真实 dirty 树 exit 1 多次复现）。
- R3 机制：不可变发布、原子指针、普通目录迁移事务、10 项健康门禁、自动回滚、双失败记录、真实 paused 回读 —— 假宿主 69 断言，且旧提交 19 断言失败（双向）。
- 真实宿主：暂停/恢复派发（paused/load/health 回读）、真实排空字段缺失导致 fail-closed、无副作用。
- 最终 `main@8fd199d` 干净树：`pnpm check` 20/202 通过、套件 69 断言、diff-check 0、diff 范围 16 文件。

**未证明（不得写成通过）**
- R3.7 真实 A→B→A 与故障注入回滚（blocked）。
- 实载插件 commit 回读（宿主无入口）。
- 真实排空 5 字段语义、真实 `hostVersion` 来源。
- P2/P5 的真实宿主端到端验收；P3/P4/G1/G2/P6–P15、GATE-B5 状态不变。
- F6 无专属动态负例。
- 独立验收（R0.4/R5.4 的「独立会话从最终提交重新克隆」）：由另一个 agent 会话做了 4 轮（见 §5），但仍是同一用户/同一台机器上的 agent，不是人类签收。

---

## 9. 证据索引

| 内容 | 路径 |
|---|---|
| PR #20 复核报告 | `/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/PR20-independent-review.md` |
| 返修/双向/最终验收日志、旧脚本快照 | `…/external-review/evidence/pr20-fix/`（`README-final-7f50c13.md`、`old-commit-final-7f50c13-suite.log`、`phase2-final-7f50c13-*.log`、`final-acceptance-main-5b6fb6e.log` 等） |
| R3.7 真实宿主尝试 | `…/external-review/evidence/r3.7-real-host/`（`README.md`、`preflight.txt`、`state-*.json`、`deploy-attempt.txt`、`resume.txt`、`final-live-lib-restore.txt`、`final-main-acceptance-8fd199d.log`） |
| 冻结计划 | `…/external-review/plan.lock.json`（`PLAN_HASH sha256:2523425a4aaed619fd51ac397e33c874a289cb2c830d1f87c39a60a4891000df`；reviewer 原始 lock 保留为 `plan.lock.reviewer-2026-11-07.json`） |
| 仓库内记录 | `docs/remediation-r3-validation.md`（§9 复核返修、§10 R3.7 尝试）、`docs/p8-deploy-record.md`、`docs/implementation-index.md`、`docs/self-check-2026-11-07.md` |

复现主命令（在最终提交的独立克隆、干净树、Node 22.19.0 下）：

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
git clone https://github.com/paxxie2/super-agent-hephi-review.git /tmp/hephi-verify && cd /tmp/hephi-verify
git checkout 8fd199da1d2437ccc9da90a0cfcca64d1646549d
cd hephi && pnpm install --frozen-lockfile && pnpm check     # 期望 exit 0，20 文件/202 tests
cd .. && node scripts/host/test-deploy-hephi.mjs             # 期望 PASS: 69 assertions
git diff --check 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1..HEAD
git diff --name-only 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1..HEAD   # 期望 16 个文件
```

---

## 10. 建议其他模型重点看什么

1. `scripts/host/deploy-hephi.sh`：普通目录迁移事务是否真的原子/可恢复；所有失败路径是否收敛到 record+非零；`record()` 的真实回读是否可能伪造或漏读；`failed-restored-previous` 是否只在真恢复后写。
2. `scripts/host/test-deploy-hephi.mjs`：新增负例是否真能抓旧缺陷（而非配合实现）；假宿主 ready 门禁修复是否引入过强/过弱假设；N4 的 PATH 垫片注入是否等价于真实 rename 失败；N5 的 paused 回读是否证明「来自宿主而非静态」。
3. `hephi/src/control/activation.ts`：v1/v2 兼容与 hash 校验顺序是否可能被绕过或误拒。
4. `hephi/tsdown.config.ts`：dirty/无 git 判定是否覆盖 staged/untracked；`HEPHI_BUILD_COMMIT` 不可覆盖 Git HEAD 的边界。
5. R3.7 的 blocked 判定是否成立：真实 `load` 只有 3 个字段是宿主能力缺口还是脚本过严（对照 checklist R3.5 原文）；`hostVersion` 是否确实无法从现有快照定义。
6. §7 的 lib 污染事件：恢复方式（移动+复制 release）是否有更安全做法（如重建 release 指向/指针化），以及「开发目录=实载目录」是否应作为独立风险项处理。
7. 文档是否把「假宿主通过」误写成「真实通过」、是否仍有「PR 未合并/20 条 FAIL」等过期表述（已核对过一轮，但建议独立 grep）。
