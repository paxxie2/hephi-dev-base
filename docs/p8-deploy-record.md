# P8 插件部署记录（2026-11-07，实验宿主 B）

按用户授权由 Agent 代操作，在实验实例 B（`http://127.0.0.1:3083`）执行一次真实部署。
记录文件（本机）：`/Users/zm/dsh-instances/experiment/logs/deploy-20261107T035710.json`。

## 流程与实测

| 步骤 | 结果 |
| --- | --- |
| 部署前状态 | `paused=false`、`running=0`、`queued=0`、runtime `ready` |
| 暂停 | `POST /orchestrator/api/executor/pause {"paused":true}` → `{"paused":true}`，负载保持 0/0 |
| 构建 | `pnpm install --frozen-lockfile && pnpm check`（插件目录 `<instance>/hephi-review/hephi`）→ 175 tests 通过、tsdown 构建完成 |
| 重启 | 终止旧 host.pid → 调用 `start.sh` → 新 pid `95434` |
| 实载回读 | 状态 API `ready`；**插件版本回读仍无入口**（`docs/g1-host-probe.md` 已记录“不具备”） |
| 部署记录 | `repoHead=185f5e96f4762284ef0a163ac563051c6f5a2146`；before/after 均为 `running=0, queued=0, paused=true, runtime=ready` |
| 恢复 | `POST executor/pause {"paused":false}` → 10 项 health 全 `ready`、`paused=false` |

## 不可变构建与回滚（2026-11-07 第二轮）

部署脚本增加：部署前快照当前 `lib` → 构建 → 发布不可变构建 `<releases>/<sha>/lib` + `meta.json` → 重启；`--rollback` 恢复最近快照并重启。

实测三轮（B 实例，暂停状态下）：

| 轮次 | 动作 | 结果 |
| --- | --- | --- |
| 1 | 部署 | 快照 `live-20261107T042937`（入口 `54bce386…`）；发布 `releases/hephi/dde783a…`（入口 `a9f7dbfe…`）；重启 ready |
| 2 | `--rollback` | 恢复快照，入口回到 `54bce386…`，重启后 `runtime=ready` |
| 3 | 再次部署 | 快照 `live-20261107T043051`，重新发布 `dde783a…`，入口回到 `a9f7dbfe…`；恢复后 10 项 health 全 `ready`、`paused=false` |

记录（本机）：`logs/deploy-20261107T043029.json`、`logs/rollback-20261107T043045.json`、`logs/deploy-20261107T043140.json`。
回滚失败保护：脚本先备份回滚前 `lib`，健康检查失败则恢复该备份并保持暂停（本轮未注入故障验证）。

## 已证明 / 未证明

- 已证明：暂停→构建→重启→状态恢复的真实链路；构建产物时间 `03:57`；实例以新进程运行且监听正常。
- 未证明：**实载插件 commit**（无回读入口，只能确认进程/构建产物时间与 live lib 入口 sha256，不能确证加载了哪个 commit）；**竞态 Trigger**（未创建新 Issue 测试）；**故障注入下的自动恢复**（脚本有回滚备份逻辑，但本轮只验证成功路径）。
- 已知限制：重启窗口内服务不可用；`lib` 切换在停机状态下用 `mv` 完成，非热切换；`meta.json` 只有 sha256，没有签名。
- 备注：脚本新增 `--hephi`/`--repo` 以适配本机 `<instance>/hephi-review` 布局（提交 `185f5e9`）。
