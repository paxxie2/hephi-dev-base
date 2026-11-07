# 宿主 B 部署前置决策与关闭记录（2026-11-07）

本记录归档已获用户授权、已经执行的 D1/D2/D4/D5 决定，并关闭本次 S3 的原三项前置。只补文档，不产生新的部署授权，不修改宿主或重新运行验收。时间同时标注 UTC 与北京时间（UTC+8）。

## 1. 结论与适用范围

| 原前置 | 结论 | 可核查事实 |
| --- | --- | --- |
| ① 处置原 2 个 open Ticket | 已完成 | 两 Ticket 于 2026-11-07 12:52:48Z（20:52:48）经用户授权，由助手调用原生 stop API 结束；保留工作区、原报告和 PR，不把停止记为业务成功。 |
| ② 明确 D1/D2/D4/D5 | 已完成并书面归档 | 下文记录排空方式、hostVersion 语义、实载回读方式与维护窗口及恢复条件；对应现存部署证据。 |
| ③ 维护窗口与授权 S3 | 已完成 | 用户已授权处理阻塞、完成收尾和实际部署；B 的候选部署在 14:12:10Z（22:12:10）完成，effects/停机/健康/插件激活记录齐全。 |

这三个部署前置不再以“缺决策文档”标 blocked。该结论不等于全部 G1 能力、A1-BIND、完整 S4 或 B5/B7 正式实验通过；不对整套方案完成比例作新估算。

原 Ticket：`b3a7d823bad0339e77dde1fb22f2060b`、`24983dd77e986b48866bb016a909d490`。原生报告分别保留 blocked/failed；原草稿 PR 未被当成成功交付。

## 2. D1：使用既有 stop-based effects 排空

**决定**：采用 `deploy-hephi.sh --drain effects`，不以 `running=0` 单字段代替排空，不绕过 open Ticket 门禁。

已执行顺序：暂停派发 → 运行中 SQLite 只读预查 → 记录宿主 PID/受管进程 → 原生 stop CLI → 观察 10 秒自动重启窗口 → 停机后复制 SQLite/WAL 并最终检查 → 切换不可变 release → 启动及健康、激活回读 → 保持暂停，核对后恢复接单。

- 预查 `precheckJson`：`mode=ro`、`ok=true`、`journalMode=wal`、`total=0`。
- 最终检查 `finalCheckJson`：`mode=copy`、`ok=true`、`journalMode=wal`、`total=0`；本次停止后复制清单只有主库，按记录原样保留，不声称复制了不存在的 WAL。
- `stopExit=0`，原生 stop 返回自动恢复暂停；旧宿主 PID `37486`，受管进程数 `2`；`autoRestartWait=10`。
- 边界：本次证明无待处理 effect 时的真实停机与排空路径；不声称已覆盖非零 effect 等待、运行中强制中断或所有恢复故障场景。

## 3. D2：hostVersion 的正式语义与来源

本次采用的完整值：

```text
dsh@0.2.1-rc.5;superagent@0.1.0;source=62d7d53723e5841eca5e02b151c1b48653650ea4;node@26.1.0
```

**决定**：这是此次部署所核对的宿主版本清单，作为部署记录的可读环境标识；不是单一软件包版本号、兼容性认证或宿主运行时源码证明。

| 字段 | 定义与来源 | 证据边界 |
| --- | --- | --- |
| `dsh@0.2.1-rc.5` | `start.sh` 使用的已安装 `@deepseek-ai/dsh` 包版本 | 不证明所有宿主依赖或能力已验收。 |
| `superagent@0.1.0` | 宿主 Super Agent 包声明版本 | 不替代运行代码的完整构建溯源。 |
| `source=62d7d537…` | 当时 Super Agent 源码仓库 HEAD | 源码 SHA 本身不能证明宿主加载了该源码编译的文件。 |
| `node@26.1.0` | `start.sh` 的实际宿主 Node 路径及版本；部署 `nodeVersion=v26.1.0` | 构建使用的 Node 与运行 Node 分别记录，不能混称。 |

上述来源来自本次解阻时的既有核对；不是本次文档补写重新探测。Super Agent 磁盘入口 SHA256 另存在 `predeploy-files.json`（`2fd74dfcd13821b57793f75373d055f53082dd2cda40b231d96d1924005f5a65`），只是文件校验值，不冒充实载证明。**赫菲插件的实载版本使用 D4 独立证明**，不从 `hostVersion` 字符串推导。

## 4. D4：插件实载版本的两条回读证据

**决定**：使用本次启动的双入口激活标识，并由全新原生任务决策中的 `pluginCommit` 交叉核对。宿主仍无通用版本查询 API，但已经具备这两种等价的插件实载回读方式；旧文档“回读不具备”不再适用于本候选。

1. 部署记录 `activation=verified`：只读取本次启动日志偏移 `8282` 后的标识；新进程 PID `95240` 的 `index`、`tools` 各出现一次，SHA 均为 `e490fe34dfd13117db2516d9b9c7cb0459c1d219`。10 项健康仅证明服务健康，必须结合此插件激活证据。
2. 全新 [Issue49](https://github.com/paxxie2/site-pnl-diagnosis/issues/49) → Ticket `ad3d50166613ff79434557484d1d7b5c` → 原生 Worker：`check.pass`、`ready.pass` 决策均记录同一 `pluginCommit=e490fe34…`。检查 run `6f202520-c43f-4931-bf50-e27d3b4d7fac` 的 before/after 一致、输出哈希独立核对一致，交付 [PR50](https://github.com/paxxie2/site-pnl-diagnosis/pull/50)，未合并。

停机前 `importProbe.ok=true` 证明 release 的双入口及依赖可导入，不独自构成运行期激活证明。磁盘哈希、symlink 目标、重启时间也不能单独替代实载回读。上述日志仍属于同用户环境中的运行证据，不是不可篡改的强绑定证明；强绑定保持关闭。

[PR30](https://github.com/paxxie2/super-agent-hephi-review/pull/30) 于 14:45:19Z（22:45:19）合并，合并提交为 `2c603c6cba2c3622ed4aa8024f0b3f9106d7c27a`；远程比较与候选 `e490fe34…` 的文件差异为 0。**已部署的构建 SHA 仍为 e490fe34，不把 main 的合并 SHA 写成实载 SHA。** 本次纯文档补充不要求重部署。

## 5. D5：授权、维护窗口与恢复接单

**决定**：执行用户在本会话中“你去处理阻塞点”“全部完成”“立刻处理”的明确授权；由主助手操作 B 的既有停机式部署，原生 Worker 负责修复，主助手独立验收。此处是授权与已执行窗口的事后归档，不是补造事前审批记录，也不授权其他实例或未来任意部署。

- 实际切换窗口：2026-11-07 14:11:47Z（22:11:47）记录受管进程并进入 stop 流程；14:12:10Z（22:12:10）部署成功记录落盘。
- 部署完成时 `paused=true`、`keptPaused=yes`、`running=0`、`queued=0`，10 项健康全部 ready，插件双入口激活 verified。
- 操作者核对上述结果后调用原生 `executor/pause {paused:false}` 恢复接单；随后 Issue49 的自动执行和 PR50 交付证明恢复后的基础链路工作。`keptPaused=yes` 描述部署结束时的状态，不能误读成服务一直暂停。
- 失败处理沿用既有 fail-closed/previous 恢复语义；不跳过 open Ticket、effects、健康或激活门禁。此前依赖缺失、测试入口遗漏等失败记录继续保留，未被最终成功覆盖。

## 6. 证据索引（既有本机产物，不提交生产原始数据）

下列路径以本次会话工作区 `/Users/zm/Documents/ChatGPT/现代软件开发` 为根：

| 证据 | 相对路径 |
| --- | --- |
| 当时决策草记与授权摘要 | `output/hephi-unblock-20261107/maintenance-decisions.json` |
| 原两 Ticket 停止回读 | `output/hephi-unblock-20261107/<上述TicketID>-stopped.json` |
| D2 来源辅助文件校验 | `output/hephi-unblock-20261107/predeploy-files.json` |
| 最终 S3 部署记录 | `output/hephi-all-prerequisites-20261107/candidate-deploy-record.json` |
| 部署运行日志（含构建及激活） | `output/hephi-all-prerequisites-20261107/candidate-deploy-paused.log` |
| 新任务原始检查和决策副本 | `output/hephi-all-prerequisites-20261107/smoke49-hephi/` |
| 独立验收汇总 | `output/hephi-all-prerequisites-20261107/最终验收.md` |

部署记录原件为 `<instance>/logs/deploy-20261107T141210Z-57984.json`。归档副本 SHA256：`804ba302d373da5b2613d3a6a986180149715b8c35d9d76844e4c3df060d7454`。
决策草记 SHA256：`1fe14e87814f4f2fc708d403a8e25cff8d7204d5ff80b95b155e05105786b12c`。

## 7. 再部署条件与未覆盖范围

后续若再次部署，必须重新核对当时的 open Ticket 和 effects，并按原生流程处置；后续实验新增的 open Ticket 属于**下一次部署的新门禁**，不回溯改变原两 Ticket 已处置的结论。“新增 3 个”仅是当时快照，不将数量当成长期固定事实；本次补文档不清任务、不操作宿主。

后续 A 线验收、代码批次与 B 线实验另按已批准清单推进。它们不是这份记录中三项部署前置的剩余工作；H2/H6、强绑定、完整 S4 和 B5/B7 的原有失败或未完成状态不因本文改变。
