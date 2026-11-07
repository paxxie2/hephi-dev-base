# 威胁模型（A4，2026-11-07，草稿）

> 状态：**2026-11-08 更新（基于 A2 真实探针结果；仍有部署侧/宿主侧未验证项）**。本文按 ROADMAP-95 §A4 编写，用于固定信任边界与已知防线；
> 涉及宿主隔离的结论依赖 G1 第 7、8 项探针（未做）与 A2 H1–H6 探针（未做），因此不能作为
> “宿主已隔离”或“证据不可伪造”的证明。

## 1. 资产与攻击者

| 项 | 说明 |
| --- | --- |
| 资产 | 检查记录（`run.json` + `output.log`）、决策日志、激活合同、ready 判定结果、真实宿主执行结果 |
| 攻击者 A：Worker（模型/被劫持的工具调用） | 能在工作区读写、能执行 bash、能请求 `hephi_check` 与 `orchestrator_report`；**能否影响自己的 Session 快照未验证（H6）** |
| 攻击者 B：同机非特权用户 | 若与插件同 UID，可读写宿主状态目录（G1 第 7、8 项未验证） |
| 攻击者 C：恶意/被篡改的插件构建 | 本模型不覆盖：构建来源由 P2/部署控制；磁盘哈希 ≠ 实载 commit（L5） |

## 2. 信任边界（当前事实）

| 边界 | 状态 | 证据/限制 |
| --- | --- | --- |
| 状态目录 `<stateDir>/hephi/` | **可被 Worker 所在进程写入**（同一宿主进程/同一 UID） | 无 OS 隔离证据；G1 第 7、8 项未做 |
| Session 快照（`sessionQuery.readSession`） | **H6 fail（一次性 profile 实测）**：Worker 可追加 `session.vN.jsonl.zstd` 事件并写伪造 `run.json` | 因此强绑定保持关闭；A1-BIND 只按“检测已列举伪造”交付，不声称不可伪造 |
| Job 接口（`jobs.get/readAt`） | 宿主服务，按 Session 隔离（H3 未验证错误 session 的行为） | 后台证据依赖它 |
| 操作者解除入口（A3 `resolutions.jsonl`） | 默认关闭；`HEPHI_ALLOW_OPERATOR_RESOLUTIONS` 只是策略开关，**不是安全边界**（Worker 的 shell 会继承宿主 env） | 可信边界待 G1 第 9 项 + 宿主配置字段；关闭时 runner/verifier 均不采信 |
| 输出绑定（A1-OUT） | 绑定生效时从 Session 结果/Job 输出重算哈希；不可得即拒绝 | A2 on bc21cac：H1 pass(path-B)、H2 fail（前台无结构化 value）、H4 pass；path-B 前台 → `ready.output-unverified` 拒绝 |

## 3. 防线与对应攻击

| 攻击 | 当前防线 | 能声称的边界 |
| --- | --- | --- |
| 手写 `run.json` + `output.log`（无真实执行） | 绑定生效时要求 Session 中唯一 bash 调用/结果（或 job/registered+settled）与合同重算命令一致；K4 无条件要求 session 归属 | 绑定关闭时仍可能通过（K7 #3 已知限制）；绑定开时仅覆盖已列举伪造方式 |
| 只改 `output.log` | `outputHash` 与日志哈希比对 | 能发现未同步修改 |
| 同时改日志和哈希 | A1-OUT 从权威来源重算 | 仅对 A1-OUT 生效的分支；权威输出不可得时 ready 拒绝 |
| 后台换 Job/跨 Session Job/仍在运行 | jobId 严格相等 + `jobs.get` + completed + 退出码 | 依赖 H3 语义；Job 清除即拒绝 |
| 旧 HEAD/旧合同/旧构建证据 | git 指纹、contractHash、pluginCommit 校验 | 已实现并有测试 |
| shell 越界写入 / 符号链接逃逸 | 范围与工作区 containment 检查 | 机械检查；真实宿主路径未验证 |
| 已解除的 run 当证据 | 解除记录只跳过阻塞，不改变记录 status；verifier 仍要求 passed | 已实现 |
| 仍在运行时解除 | CLI `--status running` 拒绝；`--accept-risk` 不适用 | 依赖操作者如实提供 `--status` |

## 4. 已知缺口（未验证，不能写成已解决）

1. 宿主隔离（G1 第 7、8 项）：若 Worker 能写状态目录，伪造记录/日志仍可能，只有 A1-BIND/A1-OUT 能发现一部分。
2. H6：Worker 若能让 Session 快照包含伪造调用，A1-BIND 失效 → 必须停止启用绑定并回到 A4 整改。
3. A3 的可信边界：操作者配置必须 Worker 不可读/不可继承；本轮只有默认关闭 + 文档告警。
4. 实载 commit 不可回读（L5）：磁盘哈希与健康不能证明运行中的代码。
5. `hephi_check` 期间的文件改动又改回（K7 #1）：指纹只能证明前后一致。

## 4b. A4 结论（2026-11-08）

- 同用户 Worker **可以**伪造 `run.json`/追加 Session 快照（H6 fail）；因此“状态目录/快照不可伪造”不成立，A1-BIND 不能作为不可伪造证明，只能作为“已列举伪造方式未被绕过”的检测层。
- 强绑定保持关闭；A1-OUT 对前台 path-B 不可得即 fail-closed；后台 Job 输出依赖 `jobs.readAt`（不可读/lossy 拒绝）。
- 部署侧新增的 activation markers/回读只证明加载了哪个构建（D4），不改变上述证据可信度结论。
- 剩余风险：真实宿主 supervisor 行为、非零 effect 等待的 drain、C3 review→Trigger、运行期网络隔离未验证。

## 5. 需要宿主/负责人决定的事项

- 是否采用 OS 级隔离（独立 UID、只读状态目录、操作者凭据）——属外部资源与安全审批。
- A3 操作者配置的存放位置与权限（仅操作者可写、Worker 不可读）。
- H6 结果若为“可影响”，是否接受“A 线降级为只检测已列举伪造”并相应下调 D1 目标。

> 本文不修改任何既有结论；R3.7/P8 仍为部分/unverified，D1 未通过。
