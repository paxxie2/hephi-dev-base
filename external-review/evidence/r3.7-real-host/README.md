# R3.7 真实宿主验收（宿主 B, http://127.0.0.1:3083）— 2026-11-07

结论：**blocked / unverified**。真实部署在排空门禁被 fail-closed 拒绝，未发生构建、指针切换或重启；
R3.7 第 3–5 项（真实 A→B→A、故障注入回滚）因此**未执行**，P8 保持未通过。

## 环境与事实（真实回读）

| 项 | 值 |
| --- | --- |
| 宿主 | `http://127.0.0.1:3083`，pid `29031`，启动 2026-11-07 05:47:12（node v26.1.0 / dsh 0.2.1-rc.5） |
| 实例 | `/Users/zm/dsh-instances/experiment`（host.pid、logs、releases） |
| 插件目录 | `<instance>/hephi-review/hephi`（profile `dsh-home/profiles/experiment` link） |
| 实载布局 | `hephi/lib` 为**普通目录**（非 symlink），已部署 release `fba676e89e…`（entry `fe404c0d…`） |
| 排空 API | `/orchestrator/api/state` 的 `load` **只有** `running/queued/maxWorkers`；`startupReservations/effects/jobs/subagents/unknown` 均不存在 |
| 进行中 Ticket | **2 个**：`b3a7d823bad0339e77dde1fb22f2060b`（person/answer）、`24983dd77e986b48866bb016a909d490`（person/failed） |
| hostVersion 来源 | 无固定宿主版本快照定义；本轮未编造，仅用 `dsh-0.2.1-rc.5+composed-config-4b20291e9ba9`（dsh 版本 + `logs/composed-config.yml` sha256 前缀，**实验性标识，语义未批准**） |

## 执行与结果（原始输出见同目录日志）

1. **暂停**（2026-11-07T01:18:03Z）：`POST /orchestrator/api/executor/pause {"paused":true}` → `{"paused":true}`；`paused=true`、load `0/0`、10 项 health 全 ready。
2. **真实部署尝试**（dry-run，target `main@5b6fb6e…`）：脚本在**排空门禁**拒绝：
   `unverified drain field: startupReservations; … effects; jobs; subagents; unknown` → `drain check failed; refusing to upgrade`，**exit 1**。
   - 未构建、未切换指针、未重启；
   - 副作用核对：host.pid 不变（29031）、releases 数 6、logs 数 8、`hephi/lib` 仍普通目录且树哈希不变（`acbe88ba…`，改动前值）。
3. **下一道门禁**（open tickets=2）因排空先失败而未到达；独立读数已记录 2 个进行中 Ticket，同样会拒绝升级（无绕过入口）。
4. **恢复派发**（2026-11-07T01:18:09Z）：`{"paused":false}` → 1s 内 `paused=false`、10 项 health 全 ready、load `0/0`。

## 额外发现与纠正（如实披露）

- 本轮 R5/PR 验收在 `/Users/zm/dsh-instances/experiment/hephi-review/hephi` 里执行过 `pnpm check`，构建写入了该目录的 `lib/`——而该目录正是宿主 profile link 的**实载插件目录**。宿主进程 05:47 启动时加载的是旧构建，之后再未重启，因此检查时出现 **磁盘 lib ≠ 已部署 release**（磁盘 index.mjs 为 `5ff4b59b…`，release entry 为 `fe404c0d…`）。
- 纠正：把被重建的 `lib` 移到 `.lib-rebuilt-20261107T011829Z`（保留审计），并从 `releases/hephi/fba676e…/lib` 恢复；恢复后 live `lib/index.mjs` = `fe404c0d…`，live lib 树哈希 = release 树哈希 = snapshot 树哈希 = `10b49b7b…`。宿主 health 无变化（10 项 ready，paused=false，load 0/0）。
- 该事件再次证明「文件哈希 ≠ 实载 commit」：宿主无实载回读入口，磁盘内容即使与 release 一致也不能证明加载了哪个 commit。

## 未验证（不得写成通过）

- R3.7 第 3 项 A→B 真实切换、第 4 项 B→A、第 5 项可恢复故障注入与自动回滚：**未执行（blocked）**。
- 真实排空字段语义（启动预留/effect/Job/子 Agent/unknown）、真实 `hostVersion` 取值来源：未验证。
- 实载插件 commit 回读：不具备入口。

证据文件：`preflight.txt`、`state-before.json`、`state-paused.json`、`deploy-attempt.txt`、`resume.txt`、`state-after-resume.json`、`live-lib-restore.txt`。

## 追加记录：最终实载 lib 恢复（2026-11-07T01:26Z）

- 本轮验收在仓库工作树 `<instance>/hephi-review/hephi` 内跑过 `pnpm check`（该目录即宿主 profile link 的实载插件目录），构建多次改写 `lib/`。最终核对：恢复前 live entry `1b9fd4ec…` ≠ 部署 release `fe404c0d…`。
- 最终处理：被重建的 lib 移到 `evidence/live-lib-rebuilt-20261107T012623Z`（仓库外，保留审计），从 `releases/hephi/fba676e…/lib` 复制恢复。
- 恢复后：live entry = `fe404c0d…`；live lib 树哈希 = release 树哈希 = snapshot 树哈希 = `10b49b7b…`；`lib` 仍为普通目录；宿主 `paused=false`、10 项 health 全 ready、load `0/0`；仓库工作树干净。
- 操作风险（已记录）：实载插件目录与实现仓库工作树是同一个目录，任何在该目录内的 `pnpm check`/`build` 都会改写实载 `lib/`；且若把备份目录留在仓库内（未跟踪），实测会触发 R2「refusing to build from a dirty working tree」。建议 R3.7 解阻后按新部署脚本把实载切换为 `releases/<sha>/lib` 指针，避免此类污染。
