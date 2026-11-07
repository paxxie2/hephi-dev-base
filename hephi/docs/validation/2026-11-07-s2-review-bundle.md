# S2 二次独立复核材料（2026-11-07，待复核）

> 用途：ROADMAP-95 §3.2 S2（独立复核）/ Z1（R3.8 二次复核）的送审材料清单。
> 本文件由实现方整理，**不构成复核结论**；复核者必须在独立 worktree/克隆中自行复跑。

## 1. 送审对象

| 项 | 值 |
| --- | --- |
| 分支 | `agent/roadmap95` |
| 基线 | `main@c0b6f6f`（PR #24 合并提交） |
| 当前 HEAD | 以 `git ls-remote origin refs/heads/agent/roadmap95` 为准（本文写作时 `44bab8f`） |
| 变更范围 | 见 §2；产品代码仅 `hephi/src/**`、`scripts/host/**`、`eval/**`、`hephi/docs/**`；**未改 main/tag** |
| 未合并 | 分支未开 PR、未合并；main 未移动 |

## 2. 变更清单（按功能）

| 工作包 | 主要文件 | 关键约束 |
| --- | --- | --- |
| A1 契约/绑定 | `hephi/src/control/activation.ts`、`evidence-verifier.ts`、`decision-log.ts`、`index.ts` | 合同 v3→4（C1 起）；旧合同只读；K4 无条件；A1-BIND 双形状；A1-OUT 权威哈希 |
| A3 恢复 | `check-store.ts`、`check-runner.ts`、`cli.ts` | resolutions 只追加、默认关闭、worker 不可采信 |
| §4.5 部署 | `scripts/host/deploy-hephi.sh`、`test-deploy-hephi.mjs`、`check-effects-db.mjs` | 停机式排空、copy 模式最终查询、left-running 策略；141 断言 |
| C4.5/C4.9/C5 | `check-runner.ts`、`check-store.ts`、`cli.ts` | 重试上限 derived counter、stats/lint-task |
| B 线工具 | `eval/**` | 仅工具，不产生效果结论 |
| A6 红队 | `hephi/tests/redteam/**` | 本地场景，注明可声称边界 |

## 3. 复核者需执行的命令（独立克隆、干净树）

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
git clone https://github.com/paxxie2/super-agent-hephi-review.git /tmp/rm95-review
cd /tmp/rm95-review && git checkout agent/roadmap95
git status --short
cd hephi && pnpm install --frozen-lockfile && pnpm check        # 期望 exit 0
cd ..
node scripts/host/test-deploy-hephi.mjs                          # 期望 PASS 141
node scripts/host/test-effects-db.mjs                            # 期望 PASS 41
node eval/check-task.mjs --self-test                             # 期望 PASS
node eval/ab-metrics.mjs --self-test && node eval/b5-plan.mjs --self-test
node eval/daily/export.mjs --self-test && node eval/daily/rework.mjs --self-test
node hephi/scripts/check-binding-host.mjs --self-test
node hephi/scripts/e2e-record.mjs --self-test
git diff --check c0b6f6f..HEAD
```

## 4. 已知限制（复核时不得要求“全部通过”）

- 真实宿主 A2（H1–H6）、真实停机式部署、实载 commit 回读：**未执行**（Z1/D1–D5/2 个 open Ticket 阻断）。
- A1-BIND 路径 B 来自历史快照，未在当前候选插件复跑；A1-OUT 前台在路径 B 下按设计拒绝。
- 绑定默认关闭（S5 未做）、红队只覆盖本地场景、C 线未启用（B5 数据未产生）。
- 生产数据/宿主日志不入库（P14），只记录路径。

## 5. 复核输出要求

- 复核报告路径：`external-review/`（仓库外）或按负责人指定；必须列：复跑命令与退出码、失败项原文、代码审查发现（按严重级）、是否可合并/是否可进入真实部署（S3）。
- 复核者不得引用实现方报告的结论替代自己的复跑；本文件任何数字以复核者实测为准。
