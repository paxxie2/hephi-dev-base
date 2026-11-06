# P15 生产历史基线：预登记与首次归档（2026-11-07）

## 1. 预登记（导出前确定，不按结果筛选）

| 项 | 规定 |
| --- | --- |
| 数据源 | 本机三个原生 Ticket 主表：`~/.dsh/state/superagent-desktop/orchestrator.sqlite`、`dsh-instances/daily/state/orchestrator.sqlite`、`dsh-instances/experiment/state/orchestrator.sqlite` |
| 窗口 | 全部现有数据（`createdAt` 不设边界）；时区 Asia/Shanghai |
| 启用判定 | 不按 `hephi/delivery` 等标签筛选；无 `ended` 记录计 `open`，不自动归为 `off` |
| 只读凭据 | 本地 sqlite `immutable=1` 只读打开；GitHub 元数据用本机 `gh` 只读 `pr view` |
| 去重 | 以 Ticket `id` 唯一；重复导出幂等（同一输入产生相同内容） |
| 目标 | 计划要求 ≥100 个唯一 Ticket；不足时如实报告，不补造 |

## 2. 归档结果

- 归档目录（本机证据，不入库）：`/Users/zm/dsh-instances/experiment/evidence/p15-baseline-20261107/`
- 文件：`tickets.json`、`summary.json`、`pr-metadata.json`、`SHA256SUMS`
- SHA256：
  - `tickets.json` `4e9c6d8c0219cbd7a669becfa32ec7d502ab3f06a751bdb42642448a33cd3c93`
  - `summary.json` `869bae8b47235a1dd13c1be48668cc7a14d2699d642a73499dfebf178c76582b`
  - `pr-metadata.json` `d578b10de87bf6927bf54d60e70006ac041448a95d058f188f03576f5bfe3c6f`
- `node eval/check-baseline.mjs --archive <dir>` → `ok: true`；篡改 `pr-metadata.json` 后 → `SHA256 不符`（已实测）
- 计数：total=60、uniqueIds=60、duplicates=0、prLinked=32、noPr=28
- 终态分布：open 33、stopped 21、completed 4、merged 2、unknown 0
- PR 元数据（来自 ticket JSON 中 `/pull/<n>` 启发式提取的 32 个唯一 PR，`gh pr view` 只读读取）：
  - 29 OPEN、3 MERGED；涉及 `paxxie2/dubbo`、`topic-bench`、`site-pnl-agent`、`site-pnl-diagnosis`、`super-agent-hephi-review`

## 2.1 第二次归档（含 Trigger/Disposition/Thread 关系表）

按资料包 P15 的“Trigger/Assignment/follows 关联”要求补充关系表导出：

- 归档目录（本机，不入库）：`/Users/zm/dsh-instances/experiment/evidence/p15-baseline-20261107-r2/`
- 文件：`tickets.json`、`triggers.json`、`dispositions.json`、`threads.json`、`trigger-threads.json`、`summary.json`、`SHA256SUMS`
- 计数（2026-11-07 04:22 导出）：Ticket 61（open 34 / stopped 21 / merged 2 / completed 4）、Trigger 85、Disposition 85、Thread 107、Trigger↔Thread 85；PR 关联 33
- `node eval/check-baseline.mjs --archive <dir>` → `ok: true`；负例：改关系文件保留旧哈希 → `triggers.json SHA256 不符`；伪造 trigger 引用 → `引用了不存在的 trigger`
- 多实例合并说明：`id`/`key` 只要求同一实例（source）内唯一；跨实例重复是数据库克隆的已知现象，校验按 source 分组
- 第一次归档（60 条、无关系表）由本次 r2 归档取代

## 3. 缺口（如实报告）

1. **未达 ≥100**：全量唯一 Ticket 仅 60（单实例最高 49）。按计划要求如实记录，不构造历史工单。
2. **样本类型**：真实数据无 `dropped` 终态（0 条）；`stopped` 21 条可用；重试/多 Assignment（14 条多 assignment）可覆盖。
3. **触发器/关联表**：r2 已导出 `trigger`、`disposition`、`thread` 与 `trigger-thread` 关联；`follows`（ticket JSON 内字段）随 Ticket 主表保存，未单独拆表。
4. **PR 关联为启发式**：来自 Ticket JSON 中出现的 `/pull/<n>` 文本，不保证覆盖所有人工记录。
5. 窗口与只读凭据仍需用户确认；本记录不代表 P15 完成。

## 4. 复现命令

```bash
node eval/export-baseline.mjs --db <stateDir>/orchestrator.sqlite ... --out <new-dir>
node eval/check-baseline.mjs --archive <new-dir>
```
