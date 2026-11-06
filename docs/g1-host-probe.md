# G1 宿主能力探针：自动部分记录（2026-11-07）

本记录只覆盖可自动回读的部分，**不构成 G1 完成**；G1 要求 11 项原编号与 3 项新增能力逐项结论，其余项必须由宿主操作者在真实 Worker / 牺牲性 Session 上人工探测并记录原始输出。

## 1. 已自动执行

- 命令：`node hephi/scripts/host-capabilities.mjs --host http://127.0.0.1:3083 --out <evidence>/host-state.json`
- 结果（EXIT=0）：`stateReadable=true`、`paused=false`、`running=0`、`queued=0`；10 项 health 全部 `ready`（runtime/relay/notice/launch/delivery/assessment/reply/evals/models/github）
- 证据文件（本机，不入库）：`/Users/zm/dsh-instances/experiment/evidence/g1-host-probe-20261107/host-state.json`
- SHA256：`d0d99d9ba363e6e6855b0ddc0c478dae2ad1173c79aa92e9f2a1353f101643ea`

## 2. 能力结论（仅限自动可判定项）

| 能力 | 结论 | 依据 |
| --- | --- | --- |
| 宿主状态读取（`/orchestrator/api/state` + `x-orchestrator-request: 1`） | 具备 | 实测 HTTP 200 并解析成功 |
| paused 标记 | 具备 | 字段存在且可读 |
| load 计数（running/queued/maxWorkers） | 具备 | 字段存在且可读 |
| 实载插件版本回读（`describePlugin` 或等价） | **不具备** | 仓库内 `describePlugin` 无调用入口，CLI 仅 `prepare`；宿主无版本查询 API |
| G1 原编号 1、2、3a、3–10 | 未验证 | 需真实 Worker 内部 bash 快照、前台/后台终态、子 Agent 事件、token 用量、相对路径、无标签对照、状态目录写权限、UID/沙箱、操作者独立通道、伪造快照等人工探针 |
| 新增 3 项（工具结果告警通道、实载版本回读、维护排空） | 未验证（第 2 项已按上表判“不具备”） | 需宿主操作者确认；排空能力仅能从 `paused`/`load` 间接观察，未实测 |

## 3. 对照环境现状

- A 实例（`http://127.0.0.1:3082`，无赫菲）：本次探测时 HTTP `000`（未运行）→ G1 第 6 项与 P4 三组对照所需的“无插件”宿主需要用户先启动。
- B 实例（`http://127.0.0.1:3083`，加载赫菲）：运行中，状态可读。

## 4. 未做的事（不得冒充通过）

- 没有伪造 Session 快照、没有执行高风险权限探针、没有创建真实 Issue/Worker 运行。
- 未把状态可读当成“工具结果告警通道具备”；该项必须由真实工具执行后观察。
