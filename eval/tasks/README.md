# 任务集目录约定（B2）

本目录存放 ROADMAP-95 工作线 B 的实验任务。**目录中的每个任务都必须先通过
`eval/check-task.mjs` 的结构校验与有效性复核，才能进入运行计划。**

## 1. 目录结构

```
eval/tasks/<repo>/<taskId>/
├── task.json        # 任务元数据 + 合法性范围（机器可读）
├── issue.md         # 给 Worker 的任务卡正文（与 native/off 两组逐字节相同）
├── hidden-test.sh   # 隐藏验收测试（在 checkout 根目录执行）
├── review.md        # 合法范围判定理由（两名评审者 + 裁决记录）
├── reference.patch  # 参考修复（unified diff，用于有效性复核；可选但推荐）
└── base/            # 仅合成自测夹具使用；真实任务只引用真实仓库的 base commit
```

`<repo>` 是与 `task.json.repo` 对应的短名（例如 `dubbo`、`ts-project`）。
`<taskId>` 必须稳定、可读，进入运行记录后不得改名。

## 2. `task.json` 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | 是 | 当前固定为 `1` |
| `taskId` | string | 是 | `^[a-z0-9][a-z0-9._-]{1,63}$`，全局唯一 |
| `repo` | string | 是 | 仓库标识/路径；真实任务为可解析的仓库 |
| `base` | string \| null | 是 | 真实任务必须写完整 40 位 commit SHA；合成自测夹具为 `null` |
| `category` | enum | 是 | `defect-fix` / `new-feature` / `behavior-preserving-refactor` / `cross-module` / `staged-suitable` |
| `referenceFix` | string | 是 | 参考修复补丁路径（相对任务目录） |
| `allowedFiles` | string[] | 是 | 合法范围 glob（与 review.md 一致） |
| `issue` | string | 是 | 任务卡路径（相对任务目录） |
| `hiddenTest` | string | 是 | 隐藏测试路径（相对任务目录） |
| `review` | string | 是 | 合法范围评审记录路径 |
| `stagedSuitable` | boolean | 是 | 是否适合 B5 的 staged 实验 |
| `contamination` | object | 是 | 训练数据污染边界，见 §4 |
| `checks` | object | 是 | `baseMustFail` / `referenceMustPass`，均为 `true` |

类别覆盖要求（ROADMAP §4 B2）：六类都要有任务，并按类别分层报告；
`staged-suitable` 只用于 staged 实验，不进入第一轮 off/native 正式对照的分层结论。

## 3. 文件内容约定

- `issue.md` 必须包含三个二级标题：`## 任务`、`## 验收`、`## 合法范围`。
  任务卡正文按原样投递给 Worker（native 为 Issue body，off 为固定 Trigger 文本注入），
  见 `eval/RUNBOOK.md`。
- `hidden-test.sh` 在 checkout 根目录执行，退出码 `0`=通过、非 `0`=失败；
  必须只依赖任务仓库已有的工具链，不得访问网络或写仓库外路径。
- `review.md` 必须写明：两名评审者的判定、合法范围、以及“配套修改 vs 无关改动”的
  具体理由；分歧时写裁决者与理由。
- `reference.patch` 由 `git diff` 生成（unified diff），只用于有效性复核，
  不投递给 Worker。

## 4. 污染边界（必须记录）

`contamination` 字段：

```json
{
  "mergedAfterTrainingCutoff": true,
  "private": false,
  "cutoff": "2026-01-01",
  "notes": "该修复在模型训练截止日期之后才合并"
}
```

ROADMAP §4 B2 要求：至少三分之一任务来自训练截止日期之后合并的修复或私有仓库，
并单独报告这部分结果。`cutoff` 在 `mergedAfterTrainingCutoff=true` 时必填；
`notes` 记录判断依据。新 Session/新检出目录只清理上下文，不构成污染防护。

## 5. 有效性复核（B2）

```sh
# 只做结构校验（不需要 git，适合任务作者本地先跑）
node eval/check-task.mjs eval/tasks/<repo>/<taskId> --dry-run

# 完整复核（需要真实/临时 git 仓库；base 隐藏测试失败、参考修复通过、连续 3 次一致）
node eval/check-task.mjs eval/tasks/<repo>/<taskId> --repo /path/to/repo --base <sha>
```

失败分类（原始失败必须保留，并计入接入成本统计）：

1. 依赖版本问题；
2. 测试提取错误；
3. 环境准备问题；
4. 任务本身无效。

只有经复核确认任务无效才可排除；`--dry-run` 不执行隐藏测试，不能替代完整复核。

## 6. 合成示例夹具

`eval/tasks/example/` 是一个**合成**任务（不来自真实仓库），用于自检工具链：

```sh
node eval/check-task.mjs eval/tasks/example --dry-run   # 结构校验：PASS
node eval/check-task.mjs --self-test                    # 自建临时 git 仓库跑完整双向复核
```

前者不访问 git；后者在系统临时目录创建合成仓库，不读写任何真实仓库。
