# B5 样本量/成本草案证据（2026-11-08）

本目录是 `eval/B5-sample-size-draft.md`（D-4 样本量 / D-3 成本草案）的原始证据。
**只读**：宿主 B 的 orchestrator sqlite（`-readonly`）与 worker session 日志（`zstd -dc`）、仓库内
`eval/evidence/b5off/ticket-*.json`；**未执行任何 run、未调用模型、未写宿主、未锁 PREREG**。

## 文件索引

| 文件 | 内容 |
| --- | --- |
| `collect-b5ss.mjs` | 证据生成脚本：只读输入 → `timings.json` / `native-usage.json` / `cost.json` / `sample-grid.json` / `native-tickets-raw.json` |
| `timings.json` | 8 次试跑逐 run 时间戳、时长、native/off/native-ready/all 汇总（median、p90 插值、null 明细）、数据来源 |
| `native-tickets-raw.json` | 4 个 native ticket 的只读快照（sqlite 导出，含 report 状态与 assignment 时间戳） |
| `native-usage.json` | native 4 个 run 的 worker session token usage（含 cacheRead 与 non-cache 两种口径；off=unknown/null） |
| `cost.json` | D-3 成本草案：金额 unknown、token 汇总、时长资源估算（顺序执行主机分钟） |
| `sample-grid.json` | `eval/prereg-sample.mjs` 样本量敏感性网格（99 次尝试：91 有效、8 被工具拒绝，逐行含 exit code/所需配对数/工具 notes） |
| `collect-output.json` / `collect-stderr.txt` | 生成脚本 stdout 摘要 / stderr（空） |
| `self-test.log` | `node eval/prereg-sample.mjs --self-test`（19 条合成断言，exit 0） |
| `prereg-lock-check.txt` | `node eval/prereg-lock.mjs --check`（D-3/D-4 草案引用写入后重跑，exit 1 为预期） |
| `check-budget.txt` | `node eval/check-budget.mjs`（exit 1：缺金额/币种/上限，D-3 尚无数值） |
| `command-log.txt` | 本轮全部命令、退出码与边界声明 |
| `SHA256SUMS` | 本目录文件 + `../B5-sample-size-draft.md` 的 sha256（`shasum -a 256 -c`） |

## 关键边界

- 8 次试跑只有 4 个真实配对、1 个 discordant 对：**不足以估计效应或样本量**；样本量网格的输入是**假设情景**。
- off token/usage 因实例已清理而 **unknown/null**；金额因没有真实价目而 **unknown**；并发上限未验证。
- D-3/D-4 在 `eval/decisions-draft.md` 中**仍为 `pending-trial`**；本文不填最终值、不写 `eval/PREREG.lock`。
