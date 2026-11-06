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

## 已证明 / 未证明

- 已证明：暂停→构建→重启→状态恢复的真实链路；构建产物时间 `03:57`；实例以新进程运行且监听正常。
- 未证明：**实载插件 commit**（无回读入口，只能确认进程/构建产物时间，不能确证加载了哪个 commit）；**回滚**（当前脚本按目录构建，没有不可变构建目录与自动回滚，P8 的回滚验收未实现）；竞态 Trigger 处理（未创建新 Issue 测试）。
- 备注：脚本新增 `--hephi`/`--repo` 以适配本机 `<instance>/hephi-review` 布局（提交 `185f5e9`）。
