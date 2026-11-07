# B5 off-group evidence (2026-11-08, Asia/Shanghai)

本目录是一次性 off 组实例（无 hephi 插件）真实执行 4 个 `previous-window-order` 任务的原始证据。
除本说明与 `SHA256SUMS` 外，其余文件都来自实际命令产物；未复制任何凭据/token。

## 运行对象

- off 实例：`DSH_HOME=/tmp/hephi-off-b5`，端口 `127.0.0.1:3093`，profile `b5off`，
  bundles=`[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-superagent]`（**无 hephi**），
  provider/model=`deepseek-account/deepseek-flash`，GitHub Source=`paxxie2/b5-off-site-pnl`。
- 运行完成后实例已停止、临时 DeepSeek 凭据已删除、`/tmp/hephi-off-b5` 已删除。
- 复核者注意：`off-host.log` 中本机 web token 已替换为 `<redacted>`；仓库/本地证据中均无凭据。

## 文件索引

| 文件 | 内容 |
| --- | --- |
| `isolation-snapshot.txt` | 启动时进程/端口/profile bundles/HEPHI env/凭据权限与记录键名快照 |
| `instance-tree.txt` | 清理前的临时实例目录树与大小 |
| `off-host.log` | 实例 host.log（web token 已 redact；含 DeepSeek 模型列表加载 3 次） |
| `off-settings-final.json` / `off-models-final.json` / `off-state-final.json` | 实例最终 settings（executor/policy/eval/source）、可路由模型、state/health |
| `source-save.log` | GitHub Source 保存请求与 HTTP 200 响应 |
| `off-issue-create.out` | 首个 off Issue 创建命令输出（URL + exit 0） |
| `off-issue-body.md` | off Issue body：`@paxxie2 ` + `issue.md`（666 bytes, sha256 `a54c17e9...`） |
| `off-issue-7-body.sha256` | off/native body 与 `issue.md` 的 sha/字节数对照 |
| `body-comparison.json` | off body 是 native #2 body 的精确前缀；差异仅为 hephi-task 合同块（670 bytes） |
| `off-issues-summary.json` / `issue-7.json` `issue-9.json` `issue-11.json` `issue-13.json` | 4 个 off Issue（无任何 label） |
| `off-tickets-final.json` / `ticket-*.json` | 4 个 off ticket 详情（stage/report/threads/session） |
| `off-prs-summary.json` / `pr-8.json` `pr-10.json` `pr-12.json` `pr-14.json` | 4 个 off PR（OPEN；head 与 branch ref 一致） |
| `no-hephi-run1.txt` / `no-hephi-final.txt` | 无 hephi 核对：`state/hephi` 不存在、activation/checks/decisions 均为 0、bundles 无 hephi、HEPHI env=0 |
| `hostb-crosscheck.json` | 宿主 B Source 监听仓库清单（不含 b5-off-site-pnl）与“无任何 host B ticket 引用本 off Issue”的核对 |
| `hostb-tickets-baseline.json` / `hostb-tickets-final.json` / `hostb-ticket-diff-*.txt` | 宿主 B ticket 基线/最终快照和 diff（新增 ticket 均为**另一条 native trial-r1 线**的 b5-native-site-pnl #10/#12，与本 off run 无关） |
| `hostb-settings-final.json` | 宿主 B Source 配置只读快照（证明未修改；off 仓库不在监听列表） |
| `collaborator-audit.log` / `cleanup-audit.log` | A 方案 collaborator 邀请 422 记录、最终无 collaborator/invitation、停止/清理审计 |
| `native-reference.json` / `native-issue-2.json` | native 侧只读核对（Issue/PR 状态；未修改任何 native 对象） |
| `multi-run-audit.txt` | 4 次 off run 的创建顺序与 PR 编号 |
| `commands.log` | 关键命令、HTTP 状态/退出码与时间审计 |

## 说明

- 证据只证明“off 实例真实接收 Issue、原生 Worker 执行并创建 PR”，不构成 B5 效果结论；
  off 组没有 hephi 合同/检查/决策记录。
- native 与 off 的配对性限制见 `eval/B5-off-entry.md`（回退仓库，非同仓）。
