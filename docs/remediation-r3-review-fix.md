# R3 返修登记：PR #20 独立复核 R3-F1–F6 与负例 N1–N5（2026-11-07）

对应 PR #20 独立复核报告 `/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/PR20-independent-review.md`（仓库外，不随提交归档）的第 3 节（R3-F1–F6）与第 6 节（重新送审门槛）。本文件逐条登记：复核根因 → 修复实现 → 对应负例与断言 → 修复前后行为差异。

> **状态（2026-11-07，返修提交 `2409613` 后更新）**
>
> - 提交：返修**已提交**为 **`240961395ce0fb323683bab21830fbdc123257d8`**（`R3 remediation: fix F1-F6 from PR #20 independent review`，父提交 `17d3827`；改动 3 文件：`scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`（wrapper 断言 `44` → `69`）；`git show --stat 2409613`：3 files changed, +376/−101）。分支 `agent/hephi-r2-remediation` 已推送 `origin`（`17d3827`），**PR #20 已创建、OPEN、未合并**；返修提交 `2409613` 待推送并追加到 PR #20。本文件等文档改动随本文件所在提交（docs）提交。
> - 验证：**旧提交方向（negative）已由独立验证者 r3-verify 实测**——扩展套件在 `17d3827` 上 exit 1、PASS 50 / FAIL 19（见 §3.2）；**修复提交方向（positive）已全绿**——`node scripts/host/test-deploy-hephi.mjs` → **`PASS: 69 assertions`，FAIL 0，exit 0**；Lead 独立复跑 `real 84.23s`（实现者两次 `83.15s`/`83.35s`），构成：主套件 46（原 44 + 2 条真实回读）+ 负例 23。全量 `pnpm test` → **20 文件 / 202 tests**（`deploy-script.test.ts` 约 `85.7s`）；`pnpm check` 的 typecheck+test+build 最终输出：`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`）。
> - **假宿主修复通过 ≠ R3.7 真实宿主验收**。本文任何结论都不改变：R3.7 真实宿主 A→B→A、实载 commit 回读、真实健康故障注入、真实 drain 字段语义全部 **unverified**；P8 真实验收 **仍为部分（未通过）**。
> - R1／R2 复核结论不变：代码层通过（见复核报告 §5），不因 R3 返修重新开启。

## 1. 复核结论与本轮返修范围

| 项 | 复核结论（`17d3827`） | 本轮处置 |
| --- | --- | --- |
| R1 activation v2 哈希 | 代码层通过（30 用例） | 未改动 |
| R2 dirty 构建拒绝与 commit 身份 | 代码层及独立真实路径通过 | 未改动 |
| R3 不可变部署与自动回滚 | **不通过**：F1–F6；原 44 断言全过但 5 组独立负例全部复现缺陷 | 修复 F1–F6；N1–N5（含 N1b）纳入仓库自动化；重新验证命令见 §4 |
| 合并状态 | PR #20 **不批准合并**，不得进入 R3.7 | PR #20 **OPEN、未合并**；返修提交 `2409613` 追加到同一 PR |

范围声明：本轮只改 `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs` 与 `hephi/tests/control/deploy-script.test.ts`（wrapper 断言计数 44→69；Lead 实现，提交 `2409613`），本文件及其余 `docs/` 记录为只读登记；**未改产品源码、未在真实宿主执行任何部署/回滚**。

**本次返修关闭的范围（不得扩大解释）**：只关闭复核报告列出的 **R3-F1–F6** 并把 **N1–N5（含 N1b）** 纳入仓库自动化。**R3.7 真实宿主验收（A→B→A 切换、实载 commit 回读、真实健康故障注入、真实 drain 字段语义）仍未验证**；PR #20 **未合并**（分支已推送 `origin/agent/hephi-r2-remediation`）。

**因果链（本文件的核心事实，不得颠倒）**：

1. **原实现 44 断言全绿**（`0d58bc3`，2026-11-07 06:51 实测），但**独立复核在同一审查提交 `17d3827` 上用 5 组独立负例 5/5 复现缺陷**（N1 普通目录首迁 EISDIR 直接阻断部署 → F1；隐式 HEAD → F2；未恢复却记 restored → F3；恢复 rename 失败绕过双失败 → F4；`paused` 硬编码 → F5；另有静态确认的 F6）。**“原套件全绿”因此不构成 R3 通过**，这正是本次返修的直接触发原因。
2. **返修后必须双向可判**：同一扩展套件在**旧提交**上应失败（negative direction，阶段 1 已实测 20 条 FAIL，r3-verify 正用最终套件补强重跑）、在**修复提交**上应通过（positive direction，`PASS: 69 assertions` / exit 0，Lead 复跑并留档；**阶段 2：Lead 已在隔离克隆（`/tmp/hephi-lead-check` @ `2409613`）复跑 `pnpm check` → exit 0、`PASS: 69 assertions`；独立验证者 r3-verify 的独立克隆复跑见 PR 讨论，不以其结果替代机制结论**）。
3. 即使双向都成立，**只证明脚本机制**，R3.7 真实宿主仍 **unverified**、P8 仍为部分、PR 未合并。

## 2. R3-F1–F6 逐条登记

### R3-F1｜首次从普通 `lib` 目录迁移必然 `EISDIR`（阻断）

- **复核根因**：旧 `snapshot_existing_lib()` 对普通目录只做 `cp -R`，原 `$hephi/lib` 仍留在原地；随后 `set_pointer()` 把临时 symlink `renameSync` 到 `$hephi/lib`，目标是非空/普通目录 → `EISDIR`，脚本 exit 1，部署无法完成。旧测试夹具只建空的 `$hephi` 目录，从未创建普通 `lib/`，故 44 断言绕过该真实旧布局。
- **修复（`deploy-hephi.sh`）**：`set_pointer()` 内新增**普通目录迁移事务**：检测 `[ -d "$hephi/lib" ] && [ ! -L "$hephi/lib" ]` 时，先 `mv` 旧目录到 `$hephi/.migration-<UTC>-<pid>`（同文件系统原子改名，路径记入 `MIGRATION_BACKUP`），再 `renameSync` 新 symlink；**第二步失败**则 `mv "$migration" "$hephi/lib"` 恢复旧目录、删除临时 symlink 并 `return 1`。所有 `set_pointer` 调用点改为 `if ! set_pointer ...`，失败写 `failed-pointer` 记录并保持暂停。`snapshot_existing_lib()` 的复制快照保留（供后续回滚边界使用），但不再承担指针切换前的清场职责。
- **对应负例**：

  | 负例 | 断言 | 结果 |
  | --- | --- | --- |
  | **N1** 普通 `lib/`（含 `legacy.mjs`）首次部署 | `N1 plain-lib first deploy exits 0`；`N1 lib becomes symlink to release A`；`N1 migration backup keeps old lib content`；`N1 success record keeps migration evidence`（4 条） | 旧提交 4/4 FAIL（`EISDIR`，见 §3.2）；修复提交：**PASS**（整套 69 全绿） |
  | **N1b** 注入迁移第二步 `renameSync` 失败 | `N1b migration rename failure exits nonzero`；`N1b old plain lib directory restored`（目录类型为普通目录且 `legacy.mjs` 存在）；`N1b failure record written`（`failed-pointer`）（3 条） | 旧提交 1/3 FAIL（无记录，另两条“碰巧”通过，见 §3.2）；修复提交：**PASS** |

- **修复前后行为差异**：修复前普通目录首迁 → `renameSync` `EISDIR`、exit 1、旧 `lib` 原样保留、无部署记录；修复后 → 旧目录原子挪到 `.migration-*`、指针切到 release、exit 0、旧内容保留在备份、记录含 `migration` 字段；第二步失败时 → 旧目录被恢复、非零退出、写 `failed-pointer`，不留悬空指针。

### R3-F2｜`--rollback` 缺 `--target` 时隐式回滚到仓库 HEAD（高）

- **复核根因**：旧脚本先把空 `target` 默认成 `git rev-parse HEAD`，之后才检查 rollback 参数；检查时 `target` 已非空，无法区分“调用者显式提供”与“脚本补默认”。实测只给 `--rollback --previous A` 会 exit 0 并切到 HEAD 对应 release，违反 R3.3。
- **修复**：参数解析新增 `target_set` / `previous_set` 标记；在**主流程最前**（`mkdir -p` 之后、读取宿主状态与任何 HEAD 默认值之前）集中校验：`rollback=yes` 时要求 `target_set=yes`（否则 `--rollback needs an explicit --target release (no implicit HEAD default)`）、`is_sha` 完整 40 位、且若给了 `--previous` 也必须是完整 SHA；任一不满足即 `fail_keep_paused` 非零退出且**无副作用**。普通部署未指定 target 时仍允许取 HEAD（该默认被限制在 rollback 分支之外）。
- **对应负例**：**N2**（5 条）——`N2 setup: release A loaded`；`N2 rollback without --target rejected`（非零且输出含 `--target`）；`N2 empty rollback target rejected`（非零且输出含 `full 40-char SHA`）；`N2 invalid rollback target rejected`（`abc`）；`N2 rejected rollbacks have no side effects`（指针、启动次数、记录条数与调用前完全一致）。旧提交 3/5 FAIL（隐式 HEAD + 有副作用，见 §3.2）；修复提交：**PASS**。
- **修复前后行为差异**：修复前缺 target → 静默取 HEAD、切换指针、写 `result=ok` 回滚记录；修复后 → 在停止宿主/切换指针之前非零拒绝，指针与进程不变，不产生任何记录。

### R3-F3｜未执行恢复也记录/输出 “previous build restored”（高）

- **复核根因**：旧代码只有 `current` 非空且目录存在才尝试恢复，但无论是否进入该分支，后续都写 `failed-restored-previous` 并输出 `previous build restored`；rollback 恢复目标用 `current` 而不是调用者显式提供且已校验的 `--previous`，记录里 `previous` 常为空字符串。
- **修复**：结果状态拆分为 `failed-no-previous` / `failed-restored-previous` / `failed-twice`。回滚失败后的恢复目标选择：显式 `--previous`（已校验）→ 否则 `current` **且仅当 `current_valid=yes`** → 都无可恢复目标时写 `failed-no-previous`（不声称已恢复）。只有“指针恢复成功 + `restart_instance` 全量健康通过”才写 `failed-restored-previous`，并带 `restoreHealth: all-required-ready`、`targetFailure: <目标阶段真实状态>`、`previous: "<kind>:<target>"`。
- **对应负例**：**N3**（4 条）——`N3 rollback failure exits nonzero`；`N3 restore record only after real pointer restore`（记录存在**且**指针确为 `releases/A/lib`、`previous` 以 `previous:` 开头）；`N3 record keeps target failure health evidence`（`targetFailure` 含 `health`）；`N3 record keeps restore health evidence`（`restoreHealth === all-required-ready`）。夹具刻意把 `$hephi/lib` 换成普通空目录以模拟“无 current 指针”，并让目标 release 健康失败。旧提交 3/4 FAIL（该世界因普通目录 `EISDIR` 直接退出、未恢复未记录，见 §3.2）；修复提交：**PASS**。
- **修复前后行为差异**：修复前 → 无恢复也写 `failed-restored-previous`、输出“已恢复”、`previous` 为空；修复后 → 无恢复写 `failed-no-previous`，真恢复才写 `failed-restored-previous` 且带两段健康证据，恢复目标语义统一为显式 previous 或通过校验的 current。

### R3-F4｜恢复指针自身失败绕过统一双失败路径（高）

- **复核根因**：普通部署与 rollback 的恢复 `set_pointer` 调用均无错误捕获，脚本 `set -e`；恢复阶段 symlink rename 失败按静态推演会直接以原始退出码（负例注入为 42）退出，不写任何记录，指针停在失败目标，不进入 `failed-twice`。
- **修复**：所有 `set_pointer` 调用（目标切换与恢复切换）都包在 `if ! set_pointer ...` 内；恢复失败写 `failed-twice` 记录并带 `targetFailure`（目标阶段）+ `restoreFailure`（恢复阶段真实错误），再 `fail_keep_paused` 非零退出。另新增 `FAIL_STATE`/`LAST_STATE`/`HEALTH_STATE` 传递，把两次失败的真实宿主状态带回记录。
- **对应负例**：**N4**（4 条）——`N4 recovery rename failure exits nonzero without raw 42`（非零且不等于注入的 42）；`N4 double-failure record written`；`N4 record keeps both failure evidences`（`targetFailure` 非空且 `restoreFailure` 含 `pointer restore`）；`N4 double-failure record keeps real paused readback`。注入方式：PATH 前置 node 垫片，只让**第 2 次** `renameSync` 失败（第 1 次是目标切换）。旧提交 4/4 FAIL——实测 `code=0` + `result:"ok"`（不是裸 42），见 §3.2；修复提交：**PASS**（`failed-twice` 记录与两段证据符合断言）。
- **修复前后行为差异**：修复后 → 非零业务退出码、`failed-twice` 记录含两段错误与真实 paused 回读、保持暂停等待人工接管。**修复前实测（r3-verify 阶段 1，2026-11-07）**：该负例在旧提交上 `exit 0`、部署被接受并写 `result:ok`（`health:"all-required-ready"`），**不是复核报告静态推演的“裸 42 退出”**——旧实现根本没走到恢复分支；根因未在阶段 1 定论（旧脚本在该夹具下把目标判为成功）。无论根因，事实是旧实现无法通过 N4 断言；修复提交上 N4 **PASS**（整套 69 全绿）。

### R3-F5｜暂停状态与双失败健康证据不可信（高）

- **复核根因**：`record()` 无条件写 `paused:true`，从不重新读取宿主状态（负例中假宿主实际 `paused=false, health ready`，记录仍写 `true` 并输出 `host remains paused`）；双失败分支写 `health:"not-checked"`，没有保存两次实际健康响应，与“双份健康证据”要求不符。
- **修复**：`record()` 写盘前调用 `read_state`，把真实 `paused`（布尔；读不到写 `"unverified"`）、`load`、`healthReadback` 写入记录；新增 `paused_now()`，成功路径与 rollback 成功路径在 `restart_instance` 之后再回读 `paused`，**不等于 `true`** 时写 `failed-not-paused` 记录并 `fail_keep_paused` 非零退出（不伪造 `true`）。`restart_instance` 记录最后一次可读状态供 `targetFailure` 使用；双失败记录使用 `restoreHealth` / `restoreFailure` 取代 `not-checked`。
- **对应负例**：**N5**（3 条）——`N5 deploy refuses success when host is not paused`（假宿主在 start 后写入 `resumed.marker` 并真实返回 `paused=false`）；`N5 record uses real paused readback (false)`；`N5 record keeps health readback`（`healthReadback.runtime.state === 'ready'`）。另在主套新增 2 条记录真实性断言：`R3-T17 success record uses real paused/load/health readback`（`paused===true`、`load.running===0`、`healthReadback` 10 项且 `github.state==='ready'`）、`R3-T08 restored record keeps both health evidences`（`restoreHealth` + `targetFailure` + 真实 paused）。旧提交 N5 3/3 FAIL、主套 2/2 FAIL（见 §3.2）；修复提交：**PASS**。
- **修复前后行为差异**：修复前 → 记录恒 `paused:true`，可与真实状态相反；修复后 → 记录来自结束时回读，读不到即 `unverified`，宿主未保持暂停时部署按失败处理且非零退出。

### R3-F6｜current release 校验结果被显式忽略（高；静态确认）

- **复核根因**：`[ -n "$current" ] && release_validate "$releases/$current" || true` 吞掉校验失败，后续仅检查 `current/lib` 目录存在就把它当恢复目标，未通过 meta／SHA／入口哈希校验的构建也可能被恢复。
- **修复**：把“继续 rollback”和“允许恢复 current”拆成两个判断。指针解析后单独计算 `current_valid`（`release_validate` 通过为 `yes`，否则 `no`，失败不再被 `|| true` 吞掉语义）；rollback 恢复目标只接受**显式 `--previous`** 或 **`current_valid=yes` 的 current**，其余走 `failed-no-previous`；显式 `--previous` 也先 `release_validate`，不通过即 `fail_keep_paused rollback previous release is invalid`。
- **对应负例**：**无专属动态负例**（本轮未补）。复核报告本身也只做了静态确认（“未单独做动态负例”）。现状：N3 覆盖“无 current 指针 → 用显式 previous 恢复”，不覆盖“current 存在但校验不通过 → 不得作为恢复目标”。该分支由代码静态检查保证，并由 N3／N4 的恢复目标选择路径**间接**经过（两例都走显式 previous，未直接打到“current 校验失败”分支）。口径确认：**测试证据仍不充分，标 unverified-by-test**（Lead 2026-11-07 确认按此写）。
- **修复前后行为差异**：修复前 → 校验失败的 current 仍可能被恢复；修复后 → 只有通过校验的 current 才可作为恢复目标，否则只记 `failed-no-previous`。

## 3. N1–N5 已纳入仓库自动化

新增负例全部写在 `scripts/host/test-deploy-hephi.mjs` 的 `runNegativeSuite()`，与主套件分离：每个负例独立 `initWorld()` 建临时目录 + 独立假宿主服务，`closeWorld()` 清理；假宿主状态服务、`start.sh`、临时 git 仓库均为隔离夹具，**不访问 3082/3083、不触碰真实 release**。

| # | 对应用例 | 覆盖复核缺陷 | 共享夹具要点 |
| --- | --- | --- | --- |
| N1 | `plain-lib` 首次迁移成功 | R3-F1 | `initWorld({plainLib:true})` 预建含 `legacy.mjs` 的普通 `lib/` |
| N1b | 迁移第二步失败恢复旧目录 | R3-F1 | node 垫片注入第 1 次 `renameSync` 失败 |
| N2 | rollback 缺参／空值／非法 SHA 无副作用 | R3-F2 | 比较指针、启动次数、记录条数快照 |
| N3 | 无 current 时用显式 previous 真恢复 | R3-F3 | `lib` 换普通空目录、目标健康失败 |
| N4 | 恢复指针失败进入双失败路径 | R3-F4 | node 垫片注入第 2 次 `renameSync` 失败 |
| N5 | 成功路径回读真实 paused | R3-F5 | `initWorld({pauseOnStart:true})` + `resumed.marker` 使假宿主真实返回 `paused=false` |

最终套件共 **69 条断言** = 主套件 46（原 44 + 2 条记录真实性断言）+ 负例 23（N1 4、N1b 3、N2 5、N3 4、N4 4、N5 3）。
返修提交上实测：**`PASS: 69 assertions`，FAIL 0，exit 0**；`real 84.23s`（Lead 独立复跑；实现者两次 `83.15s`／`83.35s`）。
旧提交 `17d3827` 上（改前快照，同样 69 条）：**PASS 50 / FAIL 19**，逐组见 §3.2。

### 3.1 与复核 §6「重新送审最低门槛」对照

| 门槛 | 覆盖情况 | 状态 |
| --- | --- | --- |
| 1. 修复 F1–F6 且 N1–N5 入仓库自动化；旧提交应失败、修复提交应通过 | N1–N5 已入 `runNegativeSuite()`；**旧提交应失败已实测**（exit 1、PASS 50 / FAIL 19，见 §3.2）；**修复提交应通过已实测**（`PASS: 69 assertions`，FAIL 0，exit 0） | 满足（双向均有实测；旧提交最终套件重跑结果以 r3-verify 补测为准） |
| 2. 增加“目标健康失败 → previous 恢复 → 全量健康 ready”正向恢复用例 | N3 覆盖 rollback 分支的正向恢复（`restoreHealth=all-required-ready`）；普通部署分支的正向恢复仍只有 T08（进程启动失败）/T09（健康失败→指针恢复） | 部分 |
| 3. rollback target／previous 参数级负例（缺参、空值、非法 SHA 均无副作用） | N2 覆盖 target 三种负例 + 无副作用断言；**previous 的非法 SHA 负例未单独覆盖**（仅代码校验） | 部分 |
| 4. 恢复 rename、状态读取、健康读取分别注入失败 | rename：N1b／N4 已注入；**状态读取失败、健康读取失败未单独注入**（N5 是状态“可读但值相反”） | 部分 |
| 5. 成功／恢复成功／无 previous／双失败记录分别校验真实 paused、health、load、pointer、previous、错误 | 成功：T17 新断言；恢复成功：N3／T08 新断言；双失败：N4；**无 previous 记录字段未单独校验** | 部分 |
| 6. Node `22.19.0`／pnpm `11.7.0` 下完整 `pnpm check`、扩展假宿主套件、复核负例 | 扩展套件已实测（69 断言全绿，`84.23s`）；全量 `pnpm test` 20 文件 / 202 tests；**完整 `pnpm check`（含构建）**：`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） | **通过** |
| 7. 代码审查通过后才进入 R3.7 真实宿主验收 | 未开始；R3.7 保持 **unverified** | 未开始 |

> 说明：上表“部分”是如实口径，不得在重新送审前被改写为“满足”；门槛 1／6 的实跑结果由 Lead 提供后回填（门槛 1 的 negative 方向已由 r3-verify 实测，见 §3.2）。

### 3.2 旧提交对照（negative direction）实测：新套件在 `17d3827` 上必须失败

来源：独立验证者 `r3-verify`（只读仓库，阶段 1），证据目录
`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/evidence/pr20-fix/`。

| 项 | 值 |
| --- | --- |
| 独立克隆 | `/tmp/pr20-verify-old`（`git clone --no-hardlinks`，detached HEAD） |
| 被测提交 | `17d3827d3a73d3afb7a3b8de130d1615bd351769`；`deploy-hephi.sh` 保持原样，sha256 `8a8a1eb290b7b569edf3a059e0a2b872389ed41f8aad3e0c55127b83676f8f83`（快照 `deploy-hephi.old-17d3827.sh`） |
| 被测套件 | 主工作树当时的新套件拷入覆盖旧测试；快照 `test-deploy-hephi.new-suite-snapshot.mjs`，sha256 `e0f495d58d5c1d97b80d5a5ad913ac8242f07e9785ecaeaba562489eed03a6ca`（**69 条断言** = PASS 49 + FAIL 20）。**注意**：最终提交 `2409613` 中的套件 sha256 为 `ef703f2598b614ed1a0c554a27e188d65c0263f2ace402081b125394cec7a621`，与快照不同（调绿时的最后调整），但断言总数同为 69；旧提交上的最终套件重跑由 r3-verify 补测：**exit 1、PASS 50 / FAIL 19**（`old-commit-final-suite.log`），与快照 20 FAIL 的差异仅 N2 side-effects 一条 |
| 环境／命令 | Node `v22.19.0`、pnpm `11.7.0`；`cd /tmp/pr20-verify-old && node scripts/host/test-deploy-hephi.mjs` |
| 首跑结果 | **exit 1**；`PASS 50 / FAIL 19`；`FAILED: 20 assertion(s)` |
| 复跑结果 | **exit 1**；同样 20 FAIL / 49 PASS，FAIL 断言名集合与首跑 `diff` 无差异（结果确定，非偶发） |

FAIL 分组（20 条，全部由新断言捕获）：

| 组 | FAIL／总数 | 失败断言 | 旧实现实测表现（原始观测） |
| --- | --- | --- | --- |
| 主套件真实回读 | 2／2 | `R3-T17 success record uses real paused/load/health readback`；`R3-T08 restored record keeps both health evidences` | 记录只有 `paused:true` 与 `health:"all-required-ready"`，无 `load`／`healthReadback`／`restoreHealth`／`targetFailure` |
| N1 普通 `lib/` 首迁 | 4／4 | 退出 0、lib 变 symlink、备份保留旧内容、成功记录含 migration | **exit 1 + `EISDIR: illegal operation on a directory, rename '.../.lib-new-*' -> '.../hephi/lib'`**；`lib` 仍是普通目录，无 `.migration-*` |
| N1b 迁移第二步失败 | 1／3 | `N1b failure record written` | 无 `failed-pointer` 记录；另两条“碰巧”通过（旧实现从不移动旧目录、`set -e` 直接退出），**不代表旧实现满足恢复语义** |
| N2 rollback 缺参 | 3／5 | 缺 `--target` 拒绝、空 target 拒绝、无副作用 | `target` 被隐式替换为仓库 HEAD，输出 `rollback target release is invalid: <HEAD sha>`；有副作用（`starts=1 records=1`） |
| N3 未真恢复却记 restored | 3／4 | 仅真恢复才记 restored、目标失败健康证据、恢复健康证据 | 该世界 `lib` 为普通目录 → 旧 `set_pointer` **EISDIR 直接退出**，未恢复、未写记录 |
| N4 恢复 rename 失败 | 4／4 | 非零且非裸 42、双失败记录、两段证据、真实 paused 回读 | **`code=0`：部署被接受并写 `result:"ok"`（`health:"all-required-ready"`）**；只有两条 `ok` 记录。**不是复核静态推演的裸 42**；根因阶段 1 未定论，但旧实现无法通过 N4 断言 |
| N5 真实 paused 回读 | 3／3 | 拒绝未暂停成功的部署、记录真实 `paused=false`、保留 `healthReadback` | 假宿主实际返回 `paused=false`，旧脚本仍 exit 0 输出 `deploy complete; host remains paused`，记录写死 `"paused":true` 且无 `healthReadback` |

结论（negative direction 成立）：新负例套件在旧提交上**真实失败**，不是“自证通过”；`N1` 的 `EISDIR` 与复核报告独立复现一致。

限制（如实标注）：

- 阶段 1 **只证明“旧提交必失败”**（改前快照）；**positive direction 已由 Lead 与本文档执行者在返修提交内容上实测**（`PASS: 69 assertions`、exit 0），但**阶段 2 的独立克隆复跑由 r3-verify 执行，尚未回填**；旧提交 × 最终套件的重跑同样待 r3-verify 回填。
- N4 在旧提交上的 `code=0` 根因未定论（是旧脚本健康判据、还是该夹具下恢复分支未被走到，阶段 1 未判定）；阶段 2 需在修复提交上确认 N4 行为符合断言。
- 本证据目录在仓库外，不随提交归档；快照 sha256 见 `artifact-hashes.txt`。

## 4. 验证命令与证据

| 项 | 值 |
| --- | --- |
| 返修分支 | `agent/hephi-r2-remediation`（已推送 origin；PR #20 OPEN、未合并） |
| 返修提交 | **`240961395ce0fb323683bab21830fbdc123257d8`**（父提交 `17d3827d3a73d3afb7a3b8de130d1615bd351769`；提交信息 `R3 remediation: fix F1-F6 from PR #20 independent review`） |
| 改动文件 | `scripts/host/deploy-hephi.sh`、`scripts/host/test-deploy-hephi.mjs`、`hephi/tests/control/deploy-script.test.ts`（wrapper 断言 44→69）；`git show --stat 2409613`：3 files changed，+376/−101 |
| 扩展假宿主套件 | `node scripts/host/test-deploy-hephi.mjs` → **`PASS: 69 assertions`，FAIL 0，exit 0**；`real 84.23s`（Lead 复跑；实现者 `83.15s`／`83.35s`）；Node `v22.19.0`、pnpm `11.7.0` |
| 全量测试（`pnpm test`） | Node `v22.19.0`／pnpm `11.7.0` → **20 文件 / 202 tests passed**；其中 `deploy-script.test.ts` 1 test 约 **85.7s**（假宿主门禁等待变长属预期；不新增测试文件） |
| 完整检查（`pnpm check` = typecheck+test+build） | `cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） |
| 旧提交对照（negative） | **已实测**：独立克隆 `17d3827` + 新套件 → **exit 1，PASS 50 / FAIL 19**，复跑一致；详见 §3.2 |
| 修复提交对照（positive） | **已实测**：返修提交上同一套件 `PASS: 69 assertions`、FAIL 0、exit 0（`84.23s`）；`pnpm check` 最终输出`cd hephi && pnpm check` → **exit 0**：`tsc --noEmit` 通过、`vitest run` **20 文件 / 202 tests passed**、`tsdown` 构建成功（`Build complete in 2943ms`）；Node `v22.19.0`、pnpm `11.7.0`，在隔离克隆 `/tmp/hephi-lead-check` @ `2409613` 上执行（原始输出：`external-review/evidence/pr20-fix/lead-clean-tree-pnpm-check.log`） |
| 原始输出归档 | negative 方向证据：`external-review/evidence/pr20-fix/`（`old-commit-negative-fails.log`、`.run2.log`、`fail-list.txt`、`README-phase1.md`、`artifact-hashes.txt`，仓库外）；positive 方向（69 断言全绿）的原始输出：`external-review/evidence/pr20-fix/`（`lead-clean-tree-pnpm-check.log`、`lead-pnpm-test-dirty-tree.log`；Lead 复跑） |

## 5. 未验证清单（不得写成通过）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| R3.7 真实宿主 A→B→A 部署与回滚 | **unverified** | 本轮未对任何真实宿主执行部署/回滚 |
| 实载插件 commit 回读 | **unverified** | 宿主仍无版本查询入口；成功记录保持 `loadedCommitReadback: unverified`，磁盘 sha256 不得替代 |
| 真实健康故障注入与自动回滚 | **unverified** | N1b/N3/N4/N5 只证明脚本机制（假宿主 + 注入垫片） |
| 真实 drain 字段语义 | **unverified** | `startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 只在假宿主按字段存在性验证 |
| 真实普通目录迁移 | **unverified** | N1/N1b 是临时目录夹具；真实宿主 `<instance>/hephi/lib` 当前已是 symlink，未在真实旧布局上迁移 |
| R3-F6 的动态负例 | **missing（未验证）** | 仅静态确认 + 代码拆分；N3／N4 只间接经过恢复目标选择路径（均用显式 previous），未直接覆盖“current 存在但校验失败”分支 |
| previous 非法 SHA 负例、状态/健康读取失败注入、`failed-no-previous` 字段校验 | **missing（未验证）** | 见 §3.1 门槛 3–5 |
| 修复提交正向通过（positive direction，阶段 2） | **已实测（假宿主）** | 返修提交 `2409613` 内容上 `PASS: 69 assertions`、exit 0（Lead 复跑 `84.23s`；**本文档执行者亦独立复跑确认 `PASS: 69 assertions`、exit 0**）；N4 修复后行为已由断言覆盖。**这不等于真实宿主验收** |
| 旧提交 × **最终**套件重跑（r3-verify 阶段 1 补强） | **进行中** | 阶段 1 的 20 条 FAIL 用的是改前快照（同样 69 断言、sha256 不同）；r3-verify 已用最终套件在 `17d3827` 重跑：**exit 1、PASS 50 / FAIL 19**（日志 `external-review/evidence/pr20-fix/old-commit-final-suite.log`）；与改前快照 20 FAIL 的差异仅 N2 的 side-effects 一条在旧脚本上变 PASS |
| 独立复核（对本返修的二次复核） | **未做** | 需独立会话按 §6 门槛复跑；本记录不能替代 |
| P8 真实验收 | **仍为部分（未通过）** | 假宿主全绿不改变 P8 状态 |

## 6. 复现方式（只读）

```sh
cd /Users/zm/dsh-instances/experiment/hephi-review
git log --oneline -3                      # HEAD 应为 2409613（返修提交），其父为 17d3827
git status --porcelain=v1                 # 返修已提交；仅 docs/ 的返修登记改动待提交
git diff -- scripts/host/deploy-hephi.sh scripts/host/test-deploy-hephi.mjs
node scripts/host/test-deploy-hephi.mjs   # 主套件 + N1–N5；断言数待 Lead 回填
```

复现 negative direction（r3-verify 阶段 1 的做法，只读）：

```sh
git clone --no-hardlinks https://github.com/paxxie2/super-agent-hephi-review.git /tmp/pr20-verify-old
cd /tmp/pr20-verify-old && git checkout 17d3827d3a73d3afb7a3b8de130d1615bd351769
# 把主工作树的新套件拷入（覆盖旧测试），旧 deploy-hephi.sh 保持不动
cp /Users/zm/dsh-instances/experiment/hephi-review/scripts/host/test-deploy-hephi.mjs scripts/host/test-deploy-hephi.mjs
node scripts/host/test-deploy-hephi.mjs   # 预期 exit 1；FAIL 清单见 §3.2
```

> 本文件不修改任何历史失败记录：`docs/remediation-r3-validation.md` §5 的 44 条断言原文与 `docs/p8-deploy-record.md` 的旧脚本真实部署记录均原样保留，仅追加复核不通过与返修事实。
