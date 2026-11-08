# 宿主契约与兼容性回归（A7，2026-11-07；2026-11-08 更新）

> 状态：**操作文档（2026-11-08 更新）**。本文只固定“赫菲依赖宿主哪些接口/字段、宿主升级前要复跑什么”。
> A2 真实探针已有定案（`hephi/docs/validation/2026-11-07-a2-final.md`：H1 pass、H2 fail、H3 pass（一次性 profile）、H4 pass、H5 pass（仅无截断分支）、H6 fail），**不再是空模板/未回填**；
> 实载 commit 回读已具备 D4 的两条等价方式（activation markers 的 index/tools + 决策 `pluginCommit`），D2（hostVersion 语义）与 D4 的正式决策见 `docs/deployment-prerequisite-decisions-2026-11-07.md`。
> 这些回读只证明加载了哪个构建，属于同用户环境的运行证据，**不是防伪隔离**；H6 历史 fail，**强绑定保持关闭**。P8 仍为部分（完整 S1/A2/A5 未通过）。

## 1. 依赖的宿主接口

| 接口 | 用途 | 当前证据 | 失败时行为 |
| --- | --- | --- | --- |
| `/orchestrator/api/state` | paused/load/health 回读 | G1 自动部分 + H0 实测 | 读不到 → 阻塞/拒绝 |
| `/orchestrator/api/executor/pause` | 维护暂停 | G1/H0 实测（`{"paused":true}`） | 失败 → 不部署 |
| `/orchestrator/api/tickets?state=open` | 升级前 open Ticket 门禁 | H0 实测（历史 2 个 open；后经授权停止/关闭） | 读不到/非 0 → 拒绝 |
| `sessionQuery.readSession(id)` | 当前 Session 事件快照（A1-BIND 核心） | A2 定案：H1 pass(path-B)、H2 fail；bc21cac 复跑同结论；H6 一次性 profile fail | 不可用 → 绑定不可启用 |
| `jobs.get(jobId, sessionId)` / `jobs.readAt` | 后台检查终态与输出（K3/A1-OUT） | H3 一次性 profile pass（含未知/错误 Session 拒绝）；生产 ready 路径仍为 manual | 不可得 → ready 拒绝 |
| `state/orchestrator.sqlite`（WAL） | 停机后 effect 最终查询 | H0/H7 实测；工具 `scripts/host/check-effects-db.mjs` | 查询失败 → 不切换 |
| `start.sh` / `dsh-superagent stop` | 维护停机与重启 | H0 实测（stop exit 0、restart 11s 健康） | 失败 → 中止并恢复 |
| 实载 commit 回读 | 证明运行的构建 | **已具备（D4）**：activation markers 的 index/tools + 决策 `pluginCommit`/启动日志；读不到时才记 `unverified` | 读不到 → 记录 `loadedCommitReadback: unverified` |

## 2. 兼容性回归规则

1. **宿主升级（DSH/Super Agent 版本变化）后、部署新插件前**，必须复跑：
   - `node hephi/scripts/check-stage-host.mjs`（staged 夹具，既有）；
   - `node hephi/scripts/check-binding-host.mjs --session <快照> --check-record <run.json> --host <url>`（H1/H2/H4 自动 + H3/H5/H6 人工步骤）；
   - `node scripts/host/check-effects-db.mjs --db <state>/orchestrator.sqlite --mode ro --json`（运行中预检查）；
   - `node scripts/host/test-deploy-hephi.mjs`（假宿主 **302 断言**，机制回归；含 F1 meta v2 完整性、legacy 显式授权、
     F2 依赖元数据交叉核对、F5 真实 activationMarker 解析、以及部署 UX：`--hephi` 实载目录校验/legacy previous 恢复语义）。
   - `--hephi` 必须指向**实载插件目录**（目录内有 `package.json` 且 `name == hephi-superagent-plugin`）；缺省
     `$instance/hephi` 在 profile/`node_modules` 布局下可能不是实载目录。脚本在**任何 pause/stop/build 之前**校验，
     失败 exit 2 且无副作用（不暂停、不停机、不写记录）。
   - `--drain effects` 正向部署时 `previous/current` 只是**恢复目标**：允许 legacy（formatVersion 1）自动通过校验，
     记录 `previousLegacy=true`；需要恢复时该 legacy 以 health-only 启动并记录 `activation=unverified-legacy`。
     **target 仍必须 v2 完整**：正向 legacy target 一律拒绝，`--rollback`/显式 legacy target 仍须 `--allow-legacy-rollback`。
   - `--drain effects` 必须显式 `--stop-command`（宿主自己的 stop 脚本）；未验证的默认 SIGINT 路径已删除（fail-closed）；停机后自动重启检测窗口默认 10s（`--auto-restart-wait` 可调）。
2. 任一项 fail → 停止部署，按 A2 记录定位；不得用“健康 ready”替代接口兼容性。
3. 插件侧假设变更（如 Session 事件形状、Job detail 格式）必须同步更新本文与 A1-BIND 的适配分支。
4. 升级前后各记录一次宿主版本（DSH 版本 + composed-config sha256 或 API 提供的版本）；`hostVersion` 的正式语义与来源已由 **D2** 归档（`docs/deployment-prerequisite-decisions-2026-11-07.md` §3）：它是部署记录的可读环境标识，不是单一软件包版本号、兼容性认证或宿主运行时源码证明。
5. 兼容性记录路径：`hephi/docs/validation/<date>-host-compatibility.md`（本模板只定义规则，不含结论）。

## 2b. 历史已核验（实载 bc21cac，2026-11-08）

| 项 | 结果 |
| --- | --- |
| S3 停机式部署（`--drain effects`） | **PASS**：pause → effects precheck(total=0) → stop CLI → copy final(total=0) → switch → start → 10/10 health；记录 `deploy-20261107T181639Z-43593.json` |
| 实载回读 | activation markers：pid 44914，index/tools 均 `bc21cac`；与 release meta pluginCommit 一致 |
| 部署后 smoke | Issue #65 → run `6bda58a8` passed/exit0/pluginCommit=bc21cac → ready.pass → PR #66 |
| A2 on 实载构建 | H1 pass(path-B)、H2 fail、H4 pass、H3/H5/H6 manual（详见 A2 定案文档 §11） |
| 部署脚本前置 | `--hephi` 必须指向实载插件目录（默认 `$instance/hephi` 在本机不是实载路径）；旧 legacy previous 作为恢复目标可自动接受（PR51 修复）；target 必须 v2 |

## 2c. 当前已核验（实载 6d24e1b，2026-11-08）

| 项 | 结果 |
| --- | --- |
| S3 部署 | **PASS**：记录 `deploy-20261107T192655Z-28428.json`；target=`6d24e1b`、previous=`bc21caca`、result=ok、activation=verified、keptPaused=yes；effects precheck/final 均 `total=0` |
| 双入口 activation | 部署时 PID 72909，index/tools 均 `6d24e1b`、10/10 health ready；**部署脚本子进程随后退出，原生 CLI 默认环境 `start` 失败（profile 不存在，失败日志保留），经既有 `start.sh`/tmux 人工恢复**为 PID 74123、双入口仍 `6d24e1b`。不得省略该人工恢复，也不宣称部署后持续存活无人工介入 |
| 正常原生链路 | Issue57 → Ticket `ef9b71e6…` → run `a2ee26c4…` check.pass → PR58 → ready.pass（binding=false）；输出 2,429 字节 < 16KiB |
| A2 H1–H6 | `6d24e1b` **未完整复跑**；`bc21caca` 复跑 H1/H4 pass、H2 fail、H3/H5/H6 manual；历史一次性 profile H3/H5 pass（H5 仅无截断分支）、H6 fail。不能把这些扩写为生产/强绑定通过 |

## 3. 已观察到的宿主差异（历史，需在当前候选复验）

| 观察 | 来源 | 影响 |
| --- | --- | --- |
| 内部 dispatch 只留 `job/registered`/`job/settled`，无 innerCallId 的 `tool/call` | A2 历史快照（2026-11-06/07） | A1-BIND 需要路径 B 适配（已实现，待复验） |
| 持久化 `tool/result.message` 无结构化 `value`，退出码只有 `[exit code: N]` 文本 | 同上 | 路径 A 前台输出不可得 → 绑定开时 `ready.output-unverified` 拒绝 |
| `jobs.get` 对错误 Session 的行为 | H3 一次性 profile pass（未知/错误 Session 拒绝）；生产 ready 路径仍为 manual | 后台证据归属判定不能仅凭一次性 profile 扩写 |
| 宿主 `load` 只有 running/queued/maxWorkers | G1/H0 | 5 个 drain 字段不可用 → §4.5 停机式排空 |
| clean shutdown 后 `sqlite3 -readonly` 无法打开（无 -shm） | H0/H7 | 停机后必须 copy 模式查询 |

> 说明：上表为 2026-11-08 实测；真实 zero-effect 之外的 drain 等待、supervisor 行为仍未验证。

## 4. 未验证 / 待完成

- A2 H1–H6 在 `6d24e1b` 上的完整复跑（生产 Session 的 H3/H5/H6 仍为 manual；H5 截断/超长 spill 分支未覆盖）。
- 宿主升级回归记录（尚无升级事件）。
- `hostVersion` 语义已由 D2 归档；实载回读入口已由 D4 提供，但读到的仍是同用户运行证据，不能当作防伪隔离证明。
- 本文不声称任何宿主契约已兼容；所有“实测”仅限所列时点与命令。
