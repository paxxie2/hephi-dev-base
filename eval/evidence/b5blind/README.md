# B5 盲评材料与 agent 独立标注（previous-window-order，2026-11-08）

> **状态：材料已导出 + agent 标注已封存；owner（人类）标注待做。**
> 本目录**不是** B5 效果结论或达标证据：只有 1 名人类 + 1 个 agent，不能冒充双人盲评 /
> 双人 kappa；流程图与限制见 `eval/B5-blind-protocol.md`。

## 1. 范围

- 8 次 `previous-window-order` 试跑（任务卡：`eval/tasks/site-pnl-diagnosis/previous-window-order/`）：
  - native 4 次：`paxxie2/b5-native-site-pnl` PR #3/#5/#8/#9；
  - off 4 次：`paxxie2/b5-off-site-pnl` PR #8/#10/#12/#14。
- 8 次运行的 base 均为任务基线 `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`；每个 case 只改
  `backend/app/domain/money.py`（见 `source-evidence.json` 与各 `case.json`）。
- 盲评材料：`materials/`（8 个 `case-XXX/`，每个含 `diff.patch`、`requirement.md`、
  `allowed-scope.md`、`case.json`，另有 `manifest.json`、`labels.template.json`）。
- 组别映射：`private-mapping.json`（**私有**，请勿在 owner 标注前打开；见 §4）。

## 2. 生成与泄漏扫描（真实执行，命令/退出码见 `commands.log`）

```sh
node eval/label/export.mjs --manifest /tmp/b5blind-work/manifest.json \
  --out eval/evidence/b5blind/materials \
  --mapping eval/evidence/b5blind/private-mapping.json --seed 20261108 --json
# exit 0；cases=8；scan.hard=[]；scan.weak=[]（export.log）

node eval/evidence/b5blind/leak-scan.mjs eval/evidence/b5blind/materials
# exit 0；files=34；hardFindings=0；notes=8（leak-scan.log）
```

- case 顺序与 `blindId` 由 `export.mjs` 用 seed `20261108` 随机打乱；材料内不含 arm / taskId /
  runId / 分支名 / PR 编号 / 仓库名 / commit message / hephi 输出。
- 独立扫描的 8 条 NOTE 是**任务卡 `review.md` 中的同一 base SHA**：8 个 case 逐字节相同、
  不区分组别（且是理解任务所需信息），因此不判为泄漏。该口径已写入 `leak-scan.mjs` 注释。
- 私有映射由 `export.mjs` 写在材料目录**之外**（脚本会拒绝把映射放进材料目录），已核对生效。

## 3. Agent 独立标注（`agent-labels.json`）

- 8/8 case 均已标注；字段：`objectiveChanged`、`requiredFunctionImplemented`、
  `implementationDefect`、`validationEnvironment`、`delivery`、`outOfScopeChanges`、
  `unrelatedChanges`、`testWeakening`（RUBRIC 枚举；无把握的 `validationEnvironment`/`delivery`
  按任务要求写 `unknown`）。
- 结果概要：`objectiveChanged=unchanged` ×8；`requiredFunctionImplemented=complete` ×8；
  `implementationDefect.verdict=none` ×8；`outOfScopeChanges.has=false` ×8（仅改允许文件）；
  `unrelatedChanges.has=false` ×8；`testWeakening.has=false` ×8；`validationEnvironment=unknown`、
  `delivery=unknown`（盲评材料不含运行环境/隐藏测试/交付记录，**未验证**，不推测）。
- 完整性校验（不接触映射）：
  ```sh
  node eval/label/import.mjs --manifest eval/evidence/b5blind/materials/manifest.json \
    --labels eval/evidence/b5blind/agent-labels.json --json
  # exit 0；ok=true；summary={expected:8,labeled:8,missing:[],complete:true}（import-validation.log）
  ```
- **诚实边界**：本 agent 在接收任务时已知 8 个 PR 的组别归属（native/off 清单由任务给出），
  材料导出后**未读取** `private-mapping.json` 做标注；但这不是完整的信息屏障隔离。材料本身不含
  组别痕迹；更强的盲法需要未接触 intake 清单的独立标注者（见协议 §5）。

## 4. 私有信息与盲法风险（**必须读**）

- `private-mapping.json`、`source-evidence.json`、`mapping-audit.txt` 含 arm/repo/PR/head 信息，
  属于**私有证据**，不随盲评材料分发。
- ⚠️ 由于本仓库是公开仓库，上述文件随本 PR 一并提交后，**仓库读者可见映射**；因此本流程的盲法
  只能靠程序纪律：**owner 标注前不得打开这些文件，也不得查看本 PR 中的 `agent-labels.json`**。
  更强隔离方式（升级路径）：在 owner 标注前把这三个文件移到仓库外私有存储，只提交材料的哈希清单。
- 材料目录已确认不含映射文件（export.mjs 强制映射在材料目录之外，见 §2）。

## 5. 文件索引

| 文件 | 内容 | 盲评可见性 |
| --- | --- | --- |
| `materials/` | 8 case 盲评材料（diff/任务卡/合法范围/case.json/manifest/template） | **可给标注者** |
| `agent-labels.json` | agent 独立标注（8/8） | owner 标注前不给 owner |
| `leak-scan.mjs` / `leak-scan.log` | 独立泄漏扫描脚本与结果（hard=0，NOTE=8） | 组织者可看 |
| `export.log` | export.mjs 输出（exit 0；hard/weak 扫描为空） | 组织者可看 |
| `import-validation.log` | import.mjs 对 agent-labels 的完整性校验（exit 0） | 组织者可看 |
| `commands.log` | 采集/导出/扫描/校验命令与结果审计 | 组织者可看 |
| `source-evidence.json` | 8 个 PR 的 base/head/files/diff SHA（私有证据） | **标注者不可见** |
| `private-mapping.json` | blindId → runId/arm/repo/base/head（私有映射） | **标注者不可见** |
| `mapping-audit.txt` | 映射自检（8 条；4 native + 4 off；head 与 PR 一致） | **标注者不可见** |
| `SHA256SUMS` | 本目录与协议文件的 SHA-256 | 组织者可看 |

## 6. 未验证项 / 非结论（必须随报告保留）

- 这是**单人 + agent** 流程，不是双人盲评：不能算双人 Cohen's kappa，不能据此声称 B4 校准门槛
  （kappa ≥ 0.7）或 B5 效果/达标。
- 盲评材料**不含**隐藏测试结果与运行记录：`validationEnvironment`/`delivery` 只能记 `unknown`。
- `requiredFunctionImplemented=complete` 仅指 diff 语义满足需求（与参考修复的行为一致），
  hidden test 未由标注者执行（未验证）。
- 样本仅 8 次、同一任务、同一基线；不足以做 native vs off 的效果推断。
- 未运行模型、未运行隐藏测试、未修改被测仓库、未合并任何 PR。
- owner 标注与 human–agent agreement 尚未产生；见 `eval/B5-blind-protocol.md`。

## 7. AI 代复核产物（owner-labels.delegate.json，2026-11-08）

负责人将 §4–§6 的 owner 标注委托给另一个 AI agent 完成；该产物以 `owner-labels.delegate.json` 收录，**labeler 保留原值 `agent:codex-owner-delegate-not-human`**，不冒充真人。

- 完整性：`owner-labels.delegate-validation.json`（import.mjs，8/8、complete=true）。
- 独立性：交接文档 `OWNER-DELEGATE.md` 明示该 agent 先读了本 README 的 §3（含 agent 标签摘要），**不构成独立盲评**；且标注者是 AI，不是 owner 真人。
- 因此：
  1. **不得**用本文件计算 human–agent agreement；
  2. **不得**用它声称 B4 达标或 B5 效果；
  3. `delegate-comparison.json` 只是“AI 代做 vs agent”的描述性对比（56/56 一致），不构成任何一致性证据。
- 盲评状态保持 **partial（single-labeler；无真人标注）**；若负责人本人或第二真人完成标注，再按 `B5-blind-protocol.md` §4–§6 计算 agreement。
