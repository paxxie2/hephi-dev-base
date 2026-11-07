# B2 开发任务集核验审计（2026-11-08）

- 基线：`main=2eb05b1a0461023e6472fa7e19fe7c7e7adad3f5`
- 范围：只核验 `eval/tasks/` 现有 2 个准备任务；**未新增业务仓库/任务**（仓库未批准）。
- 方法：读取 `eval/tasks/README.md`/`B5-preparation.md`/`check-task --help` 后，用 full-mode（非 dry-run）对每个任务在真实固定 base 上执行 3 次；保存原始 JSON/命令/退出码。
- 证据：本机执行命令与输出摘要见下；原始日志另行归档（见 §5）。本文不把夹具验证写成真实模型实验或整仓验收。

## 1. 任务清单

| 任务 | repo | base | category | environment | allowedFiles | checks |
| --- | --- | --- | --- | --- | --- | --- |
| `b5-task-key-whitelist` | hephi | `9fa8598f2beabe179b28733e484275c3775279d3` | new-feature | offline=true, lockfile=`hephi/pnpm-lock.yaml`, commandsMustMatchOffline=true | `eval/b5-plan.mjs` | baseMustFail/referenceMustPass=true |
| `previous-window-order` | site-pnl-diagnosis | `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f` | new-feature | offline=true, lockfile=`uv.lock`, commandsMustMatchOffline=true | `backend/app/domain/money.py` | baseMustFail/referenceMustPass=true |

## 2. full-mode 有效性复核（真跑）

### hephi/b5-task-key-whitelist
```
node eval/check-task.mjs eval/tasks/hephi/b5-task-key-whitelist --repo /tmp/b2b7-lead --repeats 3 --json
```
- 结果：**exit 0 / ok=true / repeats=3**
- base（期望 fail）：codes `[1,1,1]`、consistent=true、全部 `outputSha256=a7b60fbb20ed77d39fd117f99d2b557a65a54aaef5ebcb436219060d8ee5c791`
- reference（期望 pass）：codes `[0,0,0]`、consistent=true、stdout=`B5 task key boundary checks PASS`、全部 `outputSha256=8b411f28e90e0a6dadc11e24eb9ff2fc266de2dc28d4413cee4a05191af0adad`
- 范围：allowedFiles=`["eval/b5-plan.mjs"]`、changedFiles=`["eval/b5-plan.mjs"]`、outside=`[]`

### site-pnl-diagnosis/previous-window-order
```
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/previous-window-order --repo /tmp/b2b7-site --base 1e166fbe2217ac378e5bb7062cd34a2da1e75e6f --repeats 3 --json
```
- 结果：**exit 0 / ok=true / repeats=3**
- base（期望 fail）：codes `[1,1,1]`、consistent=true、全部 `outputSha256=d9cba4ddb6ba6c4162c8353fb1e98a4af91556401352215bc77fa36cbb12ae47`
- reference（期望 pass）：codes `[0,0,0]`、consistent=true、stdout=`previous_window boundary checks PASS`、全部 `outputSha256=51c6ca62c1e76cf58134ac3d3c76b36c8aeb0693b64aa609fef3e4c4d4180b3a`
- 范围：allowedFiles=`["backend/app/domain/money.py"]`、changedFiles 同、outside=`[]`
- 与既有 `validation.json` 的参考输出 hash 一致（`51c6ca62…`），说明固定 base/patch 可复现。

## 3. 字段与文件核对

| 项 | hephi | site-pnl | 说明 |
| --- | --- | --- | --- |
| 目录结构（task.json/issue.md/hidden-test.sh/review.md/reference.patch） | ✓ | ✓ | 见 `ls` 输出 |
| schemaVersion=1、taskId/合法 base(40hex)/category/referenceFix/allowedFiles/issue/hiddenTest/review/stagedSuitable/contamination/checks | ✓ | ✓ | 字段齐；base 非 null 且 40hex |
| `issue.md` 三个二级标题（任务/验收/合法范围） | ✓ | ✓ | 关键词存在 |
| hidden-test 不依赖网络/不写仓库外 | ✓ | ✓ | 仅用仓库内工具链 |
| `review.md` 合法范围理由 | ✓ | ✓ | 含“配套修改/无关改动”说明 |
| reference.patch 可应用且不越界 | ✓ | ✓ | full-mode scope ok |
| base 本就通过/不稳定/非法卡 | 未出现 | 未出现 | base 稳定 fail 3 次；reference 稳定 pass 3 次 |

## 4. 缺口（不得写成已完成）

1. **任务数量严重不足**：当前 2 个任务；B2 要求按首轮仓库补到“每仓至少 10 个”，缺口 18 个。
2. **类别覆盖不足**：2 个均为 `new-feature`；缺 `defect-fix`、`behavior-preserving-refactor`、`cross-module`、`staged-suitable` 四类。
3. **污染控制未满足**：两个任务 `contamination.mergedAfterTrainingCutoff=false`、`private=false`、`cutoff=null`（notes 明确“unknown/fixture only”）；未达到“至少 1/3 来自训练截止后合并/私有仓库”。
4. **评审者不合规**：`review.md` 记录为“第一复核：子 Agent；第二独立复核：主 Agent”，不是两名熟悉仓库的人类评审者；缺少真实评审者签名与裁决记录。
5. **非真实模型任务**：两任务均为“离线边界增强 fixture”，自述明确不代表真实模型实验、整仓构建或宿主验收；B2 的“任务来源/数据污染/代表性”未验证。
6. **无新业务仓库任务**：按清单约束未擅自选择新仓库；正式任务集扩充需负责人批准仓库与任务范围。

## 5. 复现命令与原始证据

```sh
node eval/check-task.mjs --self-test
node eval/check-task.mjs eval/tasks/hephi/b5-task-key-whitelist --dry-run
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/previous-window-order --dry-run
node eval/check-task.mjs eval/tasks/hephi/b5-task-key-whitelist --repo /tmp/b2b7-lead --repeats 3 --json
node eval/check-task.mjs eval/tasks/site-pnl-diagnosis/previous-window-order --repo /tmp/b2b7-site --base 1e166fbe2217ac378e5bb7062cd34a2da1e75e6f --repeats 3 --json
```
原始输出（本机执行日志）：`/tmp/b2b7-validate.log`（含两份完整 JSON）；本审计的 summary 与其中字段一致。

**结论**：现有 2 个任务作为离线 fixture **有效性复核 PASS（3 次一致、base 失败/reference 通过/范围不越界）**；但作为 B2 开发任务集**远未完成**（2/≥20、类别 1/5、污染控制 0/≥1/3、评审者不合规），不得据此启动 B5 正式实验或声称 B2 达标。
