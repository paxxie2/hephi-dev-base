# 维护停机与 effect 表探针记录（2026-11-07）

对应 ROADMAP-95 §4.5（停机式排空）与 A2 前置。所有命令均为本机真实执行；宿主 B = `http://127.0.0.1:3083`（DSH 0.2.1-rc.5），实例 `/Users/zm/dsh-instances/experiment`。

## 1. H0 真实停机探针（已完成并恢复）

| 步骤 | 结果 |
| --- | --- |
| 暂停 | `POST executor/pause {"paused":true}` → 1s 内 `paused=true`、load `0/0`、10 项 health ready |
| 停机 | `python3 superagent/scripts/dsh-superagent stop --profile experiment --url http://127.0.0.1:3083 --stop-timeout 30` → **exit 0**、pid `29031` 消失、状态 API 不可达、5s 内无自动重启 |
| 停机后文件 | `state/orchestrator.sqlite` 保留（311296B），`-wal/-shm` 被 checkpoint 清理 |
| 停机后查询 | `sqlite3 -readonly state/orchestrator.sqlite ...` → **失败**（`unable to open database file`）；与 H7 夹具 F 一致：clean shutdown 后只读 CLI 无法创建 `-shm` |
| 重启 | `./start.sh` → 11s 内 10 项 health ready、`paused=true`（持久化生效）、新 pid `68495`、load 0/0/3 |
| 恢复派发 | `POST pause {"paused":false}` → `paused=false`、10 项 health ready、load 0/0 |
| open Ticket | 2 个（`b3a7d823…`、`24983dd7…`），未动 |

结论：停机/重启流程可用；**停机后不得用 `sqlite3 -readonly` 兜底**，必须用 `scripts/host/check-effects-db.mjs --mode copy`。

## 2. H7 WAL/immutable 夹具结论（已完成）

- `immutable=1` 会静默漏读未 checkpoint 的 WAL 行（同夹具 4 行 → 只读到 1 行），**禁止用于 drain 判定**。
- Node 22.19 `node:sqlite` 只读模式可读 live WAL；clean shutdown 后 sidecar 缺失时会在库旁新建空 `-wal`+`-shm`（目录不可写即失败），JSON 用 `createdSidecars` 上报。
- **copy 模式最稳**：只依赖源文件读权限、replay WAL、原库零改动；作为 §4.5 停机后最终查询。

## 3. 真实 `--drain effects --dry-run` 探针（2026-11-07 14:11 UTC）

- 前置：暂停成功（paused=true、load 0/0/3）。
- `check-effects-db --mode ro` 对**真实库**：`{"ok":true,"mode":"ro","open":"uri","journalMode":"wal","total":0,"sidecarsBefore":{"wal":true,"shm":true},"createdSidecars":[]}`。
- `deploy-hephi.sh --drain effects --dry-run --effects-db <real db> --stop-command "dsh-superagent stop …" --target 6658def…` → **exit 1**，输出 `there are 2 open Tickets; finish them before upgrading (no bypass)`。
- 副作用核对：host.pid 不变（68495）、`hephi/lib` 时间/类型不变、releases 数仍 6；随后恢复派发，10 项健康 ready。
- 结论：**真实停机式部署被 open Ticket 门禁阻断（D3）**；脚本参数/真实库只读查询路径可用；未发生停机/切换。

## 4. 尚未验证（不得写成通过）

- 有 effect 排队时的真实 drain 等待行为（H0 时 effect=0，无法证明 SIGINT→drain 的等待语义）。
- 真实 `--drain effects` 完整切换（被 D3 阻断；还需 D1/D2/D4/D5 与 Z1）。
- 真实库 `effect(kind)` 数据分布与最终 copy 查询在实际有排队 effect 时的结果。
- 实载 commit 回读（L5）仍未解决，P8 保持部分/unverified。
