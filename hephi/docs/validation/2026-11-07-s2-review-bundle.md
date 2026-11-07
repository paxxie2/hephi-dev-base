# S2 二次独立复核材料（2026-11-07，待复核）

> 用途：ROADMAP-95 §3.2 S2（独立复核）/ Z1（R3.8 二次复核）的送审材料清单。
> 本文件由实现方整理，**不构成复核结论**；复核者必须在独立 worktree/克隆中自行复跑。

## 1. 送审对象

| 项 | 值 |
| --- | --- |
| 分支 | `agent/roadmap95` |
| 基线 | `main@c0b6f6f`（PR #24 合并提交） |
| 当前 HEAD | 复核基线 **`89a8c8dc75cc4c19694296b30753f7f0f5899016`**；复核修复批次（PR25 M1–M5）在此之后追加，**复核以 `git ls-remote origin refs/heads/agent/roadmap95` 为最终 SHA**；本 bundle 的命令对任意 head 适用 |
| 变更范围 | 见 §2；产品代码仅 `hephi/src/**`、`scripts/host/**`、`scripts/release/**`、`eval/**`、`hephi/docs/**`、`hephi/tests/**`；**未改 main/tag** |
| PR 状态 | **PR #25 OPEN、未合并**；`main` 未移动（`c0b6f6f`） |

## 2. 变更清单（按功能）

| 工作包 | 主要文件 | 关键约束 |
| --- | --- | --- |
| A1 契约/绑定 | `hephi/src/control/activation.ts`、`evidence-verifier.ts`、`decision-log.ts`、`index.ts` | 合同 **v5**（v3 绑定、v4 C1、v5 C3 approvers）；旧合同只读；K4 无条件；A1-BIND 双形状；A1-OUT 权威哈希；路径 B 仅历史快照观察 |
| A3 恢复 | `check-store.ts`、`check-runner.ts`、`cli.ts` | `resolutions.jsonl` 只追加（run-unblock/retry-reset）、默认关闭、worker 不可采信；真实宿主接线未验证 |
| §4.5 部署 | `scripts/host/deploy-hephi.sh`、`test-deploy-hephi.mjs`、`check-effects-db.mjs` | 停机式排空、copy 模式最终查询、left-running 策略；假宿主 141 断言；默认 SIGINT 路径未真实验证（M3） |
| C1 受保护资产 | `contracts/task.ts`、`contracts/checks.ts`、`control/discipline.ts`、`worker-mount.ts`、`activation.ts` | contract v4 / task v2；`protectedAssets`+`authorizes` 授权优先级；shell 绕过按最终 diff 复核；migrate 弱判断已记限制 |
| C3 人工审批 | `activation.ts`、`evidence-verifier.ts` | contract v5 `verification.approvers`；ready 要求名单 approver 的 APPROVED 且 commitId=PR HEAD；真实 `gh api` 分页/字段未验证 |
| C4.2 计划 | `plan-store.ts`、`worker-mount.ts`、`evidence-verifier.ts` | `plan.jsonl` append-only、绑定 contractHash；`requirePlan`（M1 修复批次引入，以最终代码为准）启用后 `plan.not-declared` fail-closed；默认未启用为降级形式 |
| C4.5/C4.6/C4.9/C5 | `check-runner.ts`、`check-store.ts`、`cli.ts`、`activation.ts`、`eval/check-task.mjs` | 重试上限 derived counter；prepare 离线下窄黑名单（M4 待补）；stats/lint-task；任务级 `environment` 校验 |
| §4.5 之外的 A 线 | `hephi/scripts/check-binding-host.mjs`、`hephi/tests/redteam/**`、`hephi/docs/validation/e2e/**` | A2/A5/A6 脚手架/模板；**A2 真实宿主结论未取得，A5/A6 未执行**；本地红队仅单测级 |
| B 线 / S1–S7 | `eval/**`、`scripts/release/preflight.mjs`、`hephi/docs/release-pipeline.md` | 仅工具/文档，不产生效果结论；S1 预检只在临时克隆；S2–S7 未执行 |

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
node eval/redteam/plan.mjs --self-test
node hephi/scripts/check-binding-host.mjs --self-test
node hephi/scripts/e2e-record.mjs --self-test
node scripts/release/preflight.mjs --dry-run                     # 期望 PASS (dry-run)
git diff --check c0b6f6f..HEAD
```

## 4. 已知限制（复核时不得要求“全部通过”）

- 真实宿主 A2（H1–H6）、真实停机式部署、实载 commit 回读：**未执行**（Z1/D1–D5/2 个 open Ticket 阻断）。
- A1-BIND 路径 B 来自历史快照只读观察（非 A2 结论，A2 记录仍为待填写模板），未在当前候选插件复跑；A1-OUT 前台在路径 B 下按设计拒绝。
- C4.2：`requirePlan` 在 M1 修复批次引入（规则名以 M1 最终代码为准）；未启用时无计划不拦截是已知降级/缺口，复核时不得按“C4.2 已拦截”验收。
- C4.6：prepare 离线扫描为窄黑名单（M4 独立复核已复现 8 类绕过），修复前不得声称“已强制”；任务级 `environment` 校验仅 `eval/check-task.mjs`。
- §4.5：默认 SIGINT 停机路径未真实验证（M3），真实部署必须显式提供 `--stop-command` 并记录；自动重启检测窗口仅 2s（M2）。
- 绑定默认关闭（S5 未做）、红队只覆盖本地场景、C 线未启用（B5 数据未产生）、A5 E2E/A6 宿主红队未执行、S1–S7 未执行。
- 生产数据/宿主日志不入库（P14），只记录路径。

## 5. 复核输出要求

- 复核报告路径：`external-review/`（仓库外）或按负责人指定；必须列：复跑命令与退出码、失败项原文、代码审查发现（按严重级）、是否可合并/是否可进入真实部署（S3）。
- 复核者不得引用实现方报告的结论替代自己的复跑；本文件任何数字以复核者实测为准。
