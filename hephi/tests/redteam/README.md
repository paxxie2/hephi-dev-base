# A6 本地红队套件（`hephi/tests/redteam/`）

对应 ROADMAP-95 §A6 与实施计划 §6.2 的“红队本地部分”。**只包含单测/模拟级用例**：
全部使用 `mkdtemp` 自建 git 仓库与 stateDir，不连接真实宿主、不写真实状态目录、不启动构建。

## 0. 可声称边界（必读）

- 通过本套件只能声称：**“下列已列举的本地场景没有被绕过，且对应的合法请求可以完成。”**
- **不能**声称“证据不可伪造”，也不能声称 D1 的真实证据链验收通过。
- 合成 Session 快照是 fixture（路径 A 结构化形状 / 路径 B `job/registered`+`job/settled` 形状），
  不是真实 Worker Session。真实宿主编码（H1–H5 / A2 Round 3）**尚未取得**。
- 两条明确的已知限制在本套件里是“记录现状”，不是“已修复”：
  1. 绑定关闭且没有权威输出时，同时改写 `output.log` 与 `outputHash` 无法被发现（`RT-OUT-02`）；
  2. 用 `git stash` 隐藏的越界改动在隐藏期间对本地 ready 不可见（`RT-SCOPE-04`）。

## 1. 运行方式

```sh
cd hephi && pnpm exec vitest run tests/redteam
```

不要运行 `pnpm build`/`pnpm check`（当前工作树是宿主实载插件目录，构建会改写 `lib/`）。

## 2. 覆盖矩阵

| 用例 id | 类别 | 攻击 / 场景 | 预期 | 实测 | 可声称边界 | 依赖真实宿主未验证项 |
| --- | --- | --- | --- | --- | --- | --- |
| RT-FORGE-01 | 伪造证据 | 手写一条字段齐全、指纹复制的记录（绑定开，Session 无该调用） | 拒绝 | 拒绝 `no native evidence` | 绑定开启时手写记录找不到原生调用 → 拒绝 | H1/H2（真实快照形状）、H6（Worker 不能影响快照） |
| RT-FORGE-02 | 伪造证据（K1） | 先跑无害命令，再手写记录使 argv/cwd 满足合同冻结命令 | 拒绝 | 拒绝 `different command or directory` | Session 实际命令与合同重算命令不一致 → 拒绝 | H1（arguments 编码）、A2 |
| RT-FORGE-03 | 伪造证据 | 复用其他 Session 的快照；或 ready 报其他 Session 而记录属于本 Session | 拒绝 | 拒绝 `different Session` / `check record belongs to Session` | 快照/记录的 Session 归属必须一致 | H4（记录 `sessionId` 与 `session.header.id` 一致性） |
| RT-FORGE-04 | 伪造证据（重放） | 把旧工单记录复制进另一工单并改写 ticketId/runId | 拒绝 | 拒绝 `missing, failed or stale evidence` | 跨工单/跨合同重放被 contractHash 与 ticket 绑定拒绝 | 无（本地合同/记录绑定）；真实宿主状态目录权限见 A4 |
| RT-OUT-01 | 输出篡改 | 只改 `output.log`（`outputHash` 不变） | 拒绝 | 拒绝 `output hash mismatch` | 日志哈希与记录不一致 → 拒绝 | 无 |
| RT-OUT-02 | 输出篡改 | 同时改 `output.log` 与 `outputHash`（绑定关、无权威输出） | **通过（已知限制）** | 通过 | 输出只与记录自身哈希一致，两者同改无法发现；不得声称不可伪造 | A1-OUT 真实权威输出（H2/H3a） |
| RT-OUT-03 | 输出篡改 | 同上，但绑定开且 Session 有结构化权威输出 | 拒绝 | 拒绝 `authoritative check output differs` + `ready.output-unverified` | 用 Session stdout/stderr 重算权威哈希 → 拒绝 | H2（结构化输出字段）、H5（截断语义） |
| RT-OUT-04 | 输出篡改 | 权威输出被标记截断 | 拒绝 | 拒绝 `authoritative check output is unavailable` + `ready.output-unverified` | 权威输出不可得不降级 | H5 |
| RT-JOB-01 | 后台检查 | Session 结果里的 jobId 与记录不同 | 拒绝 | 拒绝 `differs from the recorded Job` | Job id 必须与记录一致 | H3 |
| RT-JOB-02 | 后台检查 | `jobs.get` 取不到（已清除 / 非本 Session） | 拒绝 + `ready.job-unavailable` | 拒绝 `Job terminal state is unavailable` | 读不到终态即拒绝 | H3、G1 第 3a 项 |
| RT-JOB-03 | 后台检查 | Job 终态 `failed` | 拒绝 | 拒绝 `terminal status is failed` | 只有 `completed` + exit 0 才算通过 | H3（终态与 detail 格式） |
| RT-JOB-04 | 后台检查 | Job 仍在 `running` | 拒绝 | 拒绝 `terminal status is running` | “启动成功”≠“检查成功” | H3 |
| RT-JOB-05 | 后台检查 | Job 终态可读但输出已清除 | 拒绝 + `ready.output-unverified` | 拒绝 `authoritative check output is unavailable` | 输出不可得即拒绝 | H3a（`readAt`/`lossy`） |
| RT-JOB-06 | 后台检查 | 记录带 jobId，但 Session 只有前台结构化结果 | 拒绝 | 拒绝 `foreground Session result but the record names a Job` | kind 与记录必须一致 | H2/H3 |
| RT-STALE-01 | 过期证据 | 旧 HEAD 证据用于新提交后的代码 | 拒绝 | 拒绝 `missing, failed or stale evidence` | 前后指纹必须与当前 base→HEAD 一致 | 无（本地 git 指纹） |
| RT-STALE-02 | 过期证据 | 旧合同 hash 下的证据 | 拒绝 | 拒绝 `missing, failed or stale evidence` | 记录 contractHash 必须等于当前合同 | 无；真实合同文件完整性见 activation 测试 |
| RT-STALE-03 | 过期证据 | 旧 pluginCommit 构建产生的证据 | 拒绝 | 拒绝 `produced by another plugin build` | 证据必须来自当前内存构建 | P2 实载回读（L5）仍未验证 |
| RT-STALE-04 | 合同变更 | 状态目录里的合同副本被改（ready 不读取它） | 不影响判定 | 仍通过（用内存合同） | ready 以内存合同为准；文件完整性由 loadActivation 哈希校验负责 | 无 |
| RT-SCOPE-01 | 范围 | shell 写越界文件并提交 | 拒绝 | 拒绝 `outside the task scope` | 提交后的 diff 含允许路径外文件 → 拒绝 | 无（本地 diff）；真实权限边界见 A4 |
| RT-SCOPE-02 | 范围 | 未提交的越界写入 | 拒绝 | 拒绝 `repository/base/clean check failed` | 工作树必须干净 | 无 |
| RT-SCOPE-03 | 范围 | 符号链接逃逸 | 拒绝 | `checkoutRelative` 返回 undefined；`allowedPath` 为 false | 路径映射与 allowedPath 两层拒绝逃逸；不覆盖竞态/时序 | A4（真实宿主权限隔离） |
| RT-SCOPE-04 | 范围 | `git stash` 隐藏越界改动后再恢复 | 隐藏期不可见（已知限制）；恢复后拒绝 | 隐藏期通过；恢复后拒绝 `repository/base/clean check failed` | 本地 ready 看不到 stash 内容，这一瞬时状态是已知边界；不得声称已修复 | 需要 A4 权限隔离才能根治 |
| RT-REC-01 | 恢复 | 宿主仍报告 running 时执行 `hephi resolve` | 拒绝且不写记录 | CLI 非零 + `still reports the check as running` | CLI 必须拒绝仍在运行的执行 | G1 第 9 项（真实宿主查询能力） |
| RT-REC-02 | 恢复 | 未解除的 `unknown` 运行作为证据 | 拒绝 | 拒绝 `unfinished/unsupported check execution` | running/unknown 阻塞 ready，进入 A3 流程 | 无 |
| RT-REC-03 | 恢复 | 已解除的旧运行当作证据 | 拒绝 | 拒绝 `missing, failed or stale evidence` | 解除只恢复重新运行资格，不沿用旧结果 | G1 第 9 项 |
| RT-REC-04 | 恢复 | 宿主开关关闭时执行 `hephi resolve` | 拒绝且不写记录 | CLI 非零 + 环境变量名 | Worker 不能自行打开操作者路径 | 宿主配置接线（Lead 负责） |
| RT-FORGE-LEGAL-01/02/03 | 合法对照 | 真实（fixture）前台/后台执行 | 通过 | 通过 | 同一夹具下合法请求可以完成（绑定开/关、后台 Job） | H1–H3a |
| RT-STALE-LEGAL-01/02/03 | 合法对照 | 新 HEAD / 新合同下重新执行 | 通过 | 通过 | 重新执行后可以继续 | 无 |
| RT-SCOPE-LEGAL-01 | 合法对照 | 允许路径内的修改 + 新鲜检查 | 通过 | 通过 | 范围内正常修改可以完成 | 无 |
| RT-REC-LEGAL-01 | 合法对照 | 解除记录 + 重新运行 | 通过 | 通过 | 解除后重跑可通过，不沿用旧执行 | G1 第 9 项 |

## 3. 明确未覆盖 / 未验证

- 真实宿主上的 A6 部分：按计划放在 `eval/redteam/` 与 `hephi/docs/validation/redteam/`，需要宿主操作者。
- H1–H5/A2：真实 Session 事件形状、结构化 value 字段、Job 终态/`readAt` 语义、记录与 Session id 一致性、继承事件计数；
  本套件用合成快照覆盖“机制”，不替代真实探测。
- H6（Worker 是否能影响自己的 Session 快照）与 A4（控制面权限隔离）：未验证；本套件所有拒绝结论都建立在
  “状态目录可写、但 Session 快照由宿主产生”这一前提上。
- 继承事件（`inheritedEventCount`）过滤的专项红队属后续批次（A1 单测已覆盖 U-BIND-X1）。
- 未运行 `pnpm build`/`pnpm check`（纪律）；本目录只新增测试与说明，未改产品代码或既有测试。

## 4. 文件

| 文件 | 内容 |
| --- | --- |
| `fixtures.ts` | 自建 git 仓库/stateDir、合同、合成 Session 快照、假 Job 接口、记录改写工具、清理 |
| `forgery.test.ts` | 伪造记录、输出篡改、合法对照 |
| `stale.test.ts` | 过期 HEAD/合同/构建证据、合同变更、合法对照 |
| `background.test.ts` | Job id/终态/运行中/输出清除、kind 一致性、合法后台对照 |
| `scope.test.ts` | shell 越界、符号链接逃逸、`git stash`、合法对照 |
| `recovery.test.ts` | A3 CLI 拒绝仍在运行/开关关闭、已解除运行不作证据、解除后重跑合法对照 |
