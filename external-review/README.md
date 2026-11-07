# 外部评审与验收证据归档（2026-11-07）

本目录是 HEPHI-R2 整改全过程的**外部评审报告、实施清单、冻结计划与原始证据**归档，来自仓库外的
`/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review/`。按用户 2026-11-07
指示随代码一起推送到 GitHub，便于外部复核者直接在同一仓库内核对。

## 内容

| 文件/目录 | 说明 |
| --- | --- |
| `HEPHI-R2-remediation-checklist.md` | R0–R5 整改与验收清单（初始任务规格） |
| `HEPHI-R2-independent-review.md` | 第一轮独立复核（F1–F3 阻断项） |
| `PR20-independent-review.md` | PR #20 复核报告（R3-F1–F6，Request changes） |
| `R37-independent-review.md` | R3.7 交接与 R3 返修复核（X1–X3、P1–P3、§7 事实更正） |
| `HANDOFF-2026-11-07.md` | 第一轮交付资料（供其他模型分析） |
| `HANDOFF-R3.7-2026-11-07.md` | R3.7 阶段交付资料 |
| `plan.lock.json` / `plan.lock.hash` | 冻结计划与 `PLAN_HASH`；`plan.lock.reviewer-2026-11-07.json` 为 review 侧原始 lock |
| `pr20-review-plan.lock.json` / `r37-review-plan.lock.json` | 各轮复核的冻结计划 |
| `pr20-negative-tests.mjs` / `r37-additional-tests.mjs` | 复核方独立追加的负例/追加测试源码（只读参考） |
| `run-r2-independent.sh` / `validate_remediation_checklist.py` | 复核方脚本与清单校验器 |
| `evidence/` | 各轮原始证据：`pr20-fix/`（返修双向/最终验收日志）、`r3.7-real-host/`（真实宿主暂停/排空拒绝/恢复/实载 lib 恢复）、`r3.8/`（X1–X3 双向与最终 main 验收）、`r37-independent/`、`pr20-independent/`、`r5/`、`p15-baseline-20261107-r2/`、`host-state.json`、`logs/` |

## 排除项（未归档）

- 独立复核用的 Git 克隆/工作树（`hephi-review/`、`pr20/`、`r37-review/`、`r2-independent-git/`、
  `r2-independent-archive/`、`dirty-probe/`），每个约 80MB；它们可由对应提交重新克隆/检出复现。
- 生产实例日志与宿主运行数据（按 P14 不提交，只记录路径）。

## 说明

- 本目录只含评审/证据文件，**不改变产品代码**；加入时点晚于 `plan.lock.json` 冻结范围（用户指示归档）。
- 归档前做过凭据扫描：未发现 `gho_`/`ghp_`/`github_pat_`/Bearer token 等敏感串；仍建议外部复核者不要在这些证据中写入新凭据。
- 当前结论口径：R1/R2 代码层通过；R3 主套 + F1–F6 + X1–X3 假宿主验证通过但**对 `cfb5a18` 的二次独立复核未做**；
  R3.7 真实宿主验收 **blocked**；**P8 仍为部分/unverified**。
