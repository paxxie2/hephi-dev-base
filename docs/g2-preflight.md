# G2 基线预检记录（2026-11-07）

本记录只证明配置项与可回读事实相符，**不构成 G2 验收通过**：八项原要求的非原实现者审查、主干合并与基线标签仍需人工完成。

| # | 检查 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 执行根与远端 | `git fetch origin` | 成功；`origin/main` 由 `abc27dd` 更新为 `718087c` |
| 2 | 文档基线 | `git rev-parse origin/main` | `718087c9f2630229d9dafaf33359445ff8745a66`，与资料包声明的文档基线一致 |
| 3 | 远端标签 | `gh api repos/paxxie2/super-agent-hephi-review/git/refs/tags` | `404 Not Found`（远端无任何标签，`hephi-baseline-1` 不存在） |
| 4 | 执行分支 | `git ls-remote --heads origin 'refs/heads/codex/*'` | 空：远端没有 `codex/dual-instance-hephi`（本地分支 HEAD 为 `a96dc1b`） |
| 5 | c547 原始提交 | `gh api repos/.../commits/c547dc1...` | `422 No commit found for SHA`（远端无该提交；旧目录已删除）；等价修复见 `b8415e9` |
| 6 | 八项原文 | `gh api repos/.../issues/1 --jq .body` | 取到「必须验收」1–8 条逐字原文 |
| 7 | 分支与主干关系 | `git rev-list --count` | 本分支相对 `a212d69` 有 10 个提交；`a212d69` 比 `origin/main` 落后 6 个提交；本分支尚未包含 main |

## 结论

- 只读预检通过：基线 SHA 正确、无标签冲突、远端无同名执行分支、c547 不可直接取用（已按资料包允许的“等价修复”处理）。
- 未完成（需人工）：八项原要求的非原实现者逐项审查；是否把本分支合入 `main`；合并后创建 `hephi-baseline-1`（不得覆盖同名异 SHA）。
- 按用户决定，不使用 GitHub Actions；`.github/workflows/hephi-check.yml` 已删除，P1 不实施。
