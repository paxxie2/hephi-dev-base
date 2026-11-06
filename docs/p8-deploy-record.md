# P8 插件部署记录（2026-11-07，实验宿主 B）

按用户授权由 Agent 代操作，在实验实例 B（`http://127.0.0.1:3083`）执行一次真实部署。
记录文件（本机）：`/Users/zm/dsh-instances/experiment/logs/deploy-20261107T035710.json`。

## 流程与实测

| 步骤 | 结果 |
| --- | --- |
| 部署前状态 | `paused=false`、`running=0`、`queued=0`、runtime `ready` |
| 暂停 | `POST /orchestrator/api/executor/pause {"paused":true}` → `{"paused":true}`，负载保持 0/0 |
| 构建 | `pnpm install --frozen-lockfile && pnpm check`（插件目录 `<instance>/hephi-review/hephi`）→ 175 tests 通过、tsdown 构建完成（**该轮时点**；当前为 20 文件 / 202 tests） |
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

## 升级前置：进行中 Ticket 保护（2026-11-07）

部署脚本在暂停/排空检查之后新增“进行中 Ticket”保护：`GET /orchestrator/api/tickets?state=open` 计数 >0 时拒绝升级，需显式 `--allow-open-tickets` 才跳过（对应 P5“有进行中赫菲工单时禁止升级”）。

实测（B 实例暂停状态下）：存在 3 个进行中 Ticket → 不带 flag 输出“仍有 3 个进行中的 Ticket，禁止升级”；带 `--allow-open-tickets` → dry-run 检查通过；随后恢复实例，health 全 ready。

## 全量健康门禁缺口（历史事实保留，R4 追记）

`logs/deploy-20261107T054720.json`（`at = 2026-11-06T21:47:20Z`，release `fba676e89ee19b2cbcf685cdb8b2a350504021fc`，用于 P11 smoke 重启）的 `after.health` 中 **`github.state = "starting"`**（其余 9 项 ready）。当时脚本只以 `health.runtime.state == ready` 判成功，因此该次部署仍按成功结束——这是**原始事实，保留不改**，也正是独立复核 F1.3 指出的健康门禁缺口。

| 项 | 值（原始记录） |
| --- | --- |
| 记录文件 | `/Users/zm/dsh-instances/experiment/logs/deploy-20261107T054720.json`（评审副本：`external-review/evidence/logs/`） |
| `github.state` | `starting`（detail 为空） |
| 其余 health | runtime/relay/notice/launch/delivery/assessment/reply/evals/models 均 `ready` |
| 脚本判定 | 成功（旧脚本只看 `runtime`） |

## R3：不可变部署、自动回滚与全量健康门禁

### 假宿主验证（已通过，提交 `0d58bc3`）

`scripts/host/deploy-hephi.sh` 已由 R3 重写：`--host-version` 必填（单行非空）、`git archive <sha>` 到独立临时目录构建、`releases/<sha>/` 不可变（`.incoming-<sha>-<pid>` + 校验 + 原子 `mv`）、`$hephi/lib` 用同文件系统临时 symlink 原子 rename 切换、10 项全量健康门禁（`runtime relay notice launch delivery assessment reply evals models github`，`starting`／`error`／缺失均失败）、切换后失败自动恢复 previous 并再次全量健康检查、失败两次保持 `paused=true`、`--allow-open-tickets` 作为未知参数拒绝、drain 字段缺失按 `unverified` 拒绝。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 假宿主 R3-T01–T17（含清单外 R3-T07b） | **PASS: 44 assertions**，退出 0；`real 50.22s`（实现者）／`49.55s`（R4 复核） | `scripts/host/test-deploy-hephi.mjs`；44 条断言原文见 `docs/remediation-r3-validation.md` §5 |
| vitest 入口 | 1 passed，约 `50s` | `hephi/tests/control/deploy-script.test.ts` |
| 指定的全量测试 | **20 文件 / 202 tests passed**（Node `v22.19.0`、pnpm `11.7.0`） | 本轮复跑；时点链见 `docs/implementation-index.md` §6.1 |

### 真实宿主验收（仍未验证）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| A→B→A 真实切换 + 实载 commit 回读 | **未验证** | 宿主无版本查询入口；脚本成功记录已明确标 `loadedCommitReadback: unverified`，磁盘 sha256 不得替代实载 |
| 受控健康故障注入与自动回滚 | **未验证** | 假宿主 T08–T10 只证明脚本机制 |
| 暂停期受控 Issue smoke、恢复后完整健康/load | **未验证** | R3.7 第 6 项未执行 |
| drain 真实 API 字段语义 | **未验证** | `startupReservations`/`effects`/`jobs`/`subagents`/`unknown` 仅在假宿主按字段存在性验证；真实 API 缺失即拒绝，不按 0 |
| 真实 `hostVersion` 取值来源 | **未验证** | 本轮未做真实部署，仅验证必填/单行校验 |

> 本文件上方全部真实部署记录（`03:57`、`04:29`–`04:31`、`05:47`）均为 **R3 之前的旧脚本**行为，不代表 R3 结论。P8 真实验收在 R3.7 完成并保存原始输出前保持**未通过**。

## 已证明 / 未证明

- 已证明：暂停→构建→重启→状态恢复的真实链路；构建产物时间 `03:57`；实例以新进程运行且监听正常。
- 未证明：**实载插件 commit**（无回读入口，只能确认进程/构建产物时间与 live lib 入口 sha256，不能确证加载了哪个 commit）；**竞态 Trigger**（本记录未创建新 Issue 测试；后由 `docs/p8-race-record.md` 单独验证，结论 partial）；**故障注入下的自动恢复**（假宿主已由 R3 `0d58bc3` 的 T08–T10 覆盖，**真实宿主未验证**）；**全量健康门禁**（假宿主已由 T09 覆盖，**真实宿主未验证**；旧脚本只看 `runtime`，`deploy-20261107T054720.json` 已记录 `github=starting` 仍判成功）。
- 已知限制：重启窗口内服务不可用；本记录中的 `lib` 切换在停机状态下用 `mv` 完成，非热切换（R3 改为 release 目录 + 版本指针，尚未验收）；`meta.json` 只有 sha256，没有签名。
- 备注：脚本新增 `--hephi`/`--repo` 以适配本机 `<instance>/hephi-review` 布局（提交 `185f5e9`）。
