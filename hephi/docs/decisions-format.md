# 决策日志格式（P3）

每个赫菲工单在 `$HEPHI_STATE_DIR/hephi/<ticketId>/decisions.jsonl` 追加写入，一行一个 JSON 对象。
实现见 `src/control/decision-log.ts`。

## 字段

| 字段 | 说明 |
| --- | --- |
| `version` | 格式版本，当前 `1` |
| `seq` | 工单内唯一、递增；只按最后一行的 seq+1 分配，不重写历史行 |
| `at` | ISO 时间 |
| `ticketId` | 工单 ID |
| `sessionId` | 产生判定的 Worker Session |
| `callId` | 宿主工具调用 ID（ready 为 `orchestrator_report` 的调用） |
| `tool` | `write` / `edit` / `hephi_check` / `orchestrator_report` |
| `mode` | `enforce` / `shadow`（shadow 下 effective 恒为 allow，would 记录本应判定） |
| `effectiveDecision` | 实际生效的判定 `allow` / `deny` |
| `wouldDecision` | 规则本应给出的判定；enforce 下与 effective 相同，shadow 下用于统计"本应拒绝" |
| `rule` | 固定规则编号 |
| `reason` | 拒绝原因或记录说明（可空） |
| `contractHash` | 判定时使用的合同哈希 |
| `pluginCommit` | 产生判定的插件构建 commit |
| `binding` | 可选（A1-K5b）。该次 ready 判定实际生效的 Session 绑定策略：`{ contract, host, effective }`；`contract: null` 表示合同版本（v1/v2）没有冻结该值。仅新增可选字段，`version` 保持 `1`，旧读者忽略即可。 |

## 规则编号

- `scope.allowed` / `scope.outside-checkout` / `scope.outside-task`：写/改文件前的路径与范围判定
- `check.pass` / `check.blocked` / `check.unknown` / `check.running`：`hephi_check` 结果与拒绝运行
- `ready.pass` / `ready.binding` / `ready.evidence-missing` / `ready.pr-mismatch` / `ready.plugin-build` / `ready.other`
- `ready.job-unavailable` / `ready.output-unverified`：A1-BIND/A1-OUT 专用拒绝——后台 Job 终态在 ready 时不可读或无 Job 接口；权威输出（Session 前台 stdout/stderr 或 Job `readAt`）不可得、`lossy`、被截断或与记录不一致。`version` 与字段不变，仅新增规则编号。

## 写入约束

- 只追加：任何实现都不得重写、删除或压缩历史行。
- 并发：同一进程内按日志文件串行分配 `seq`；写入使用追加模式。**跨进程并发未加文件锁**（已知限制，尚未实现）。
- 写失败（只读目录、磁盘错误）：判定结果不变，错误写入 stderr，`appendDecision` 返回 `{ok:false, logError}`，不补造记录。
- 脱敏、权限（文件 0600）与保留期按 P14 的数据规则执行；本日志不含 diff 内容。
