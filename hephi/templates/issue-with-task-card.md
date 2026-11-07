# Issue 模板：带 hephi-task 任务卡的交付请求（C5）

> 用途：Issue 作者用本模板写清目标、验收项、合法改动范围和检查引用，prepare 会把任务卡冻结进激活合同。
> 本文件是模板与写作建议，不是自动校验；`hephi lint-task` / `eval/check-task.mjs` 用于离线提示。

## 1. Issue 正文模板

```markdown
<一句话说明要修什么/做成什么，以及为什么>

## 背景与复现（修 bug 类任务必填）
- 现象/期望：
- 复现命令或最小步骤：
- 环境（版本/依赖锁）：

## 不在范围内
- <明确列出不该顺手改的文件/模块/重构>
- 不合并 PR；（可选）不改依赖、不改检查配置、不改 CI

## 验收方式
- 每个验收项对应一个项目已有检查（优先 `project-regression` 或专门的 test check）。

```hephi-task
{
  "version": 1,
  "goal": "<一句话目标，可核对>",
  "outOfScope": [
    "不得修改其他文件、配置、测试或 Skill",
    "不得合并 PR",
    "失败如实报告 blocked，不绕过检查"
  ],
  "acceptance": [
    {
      "id": "AC1",
      "text": "<可机械核对的验收断言>",
      "check": "project-regression",
      "paths": ["path/to/file", "path/to/other"]
    }
  ]
}
```
```

## 2. 任务卡写法（hephi-task 块）

- `version`：当前为 1（需要"受保护验收资产授权"时用 version 2，并给 `authorizes`）。
- `goal`：一句可核对的目标；不要写"优化一下"这类不可验收的话。
- `acceptance[]`：每项含
  - `id`：稳定标识（如 AC1）；
  - `text`：可机械核对（哪个文件、什么行为、哪个测试通过）；
  - `check`：项目已有检查 id（优先 test 类）；
  - `paths`：该验收项需要改动的**精确文件或目录 glob**；所有最终改动必须落在某个验收项的 paths 内。
- `outOfScope`：明确列出禁止顺带做的事（其他模块、无关重构、格式化、依赖升级、检查配置）。
- 受保护测试：若必须修改/删除已有测试，用 version 2 的 `authorizes` 精确列出"文件+操作"（modify/delete/migrate），不要扩大 `allowedPaths`。

## 3. 拆分建议（C4.7 / C5）

- 一个 Issue 只做一件事；验收项建议 1–5 个，超过 8 个时用 `hephi lint-task` 的提示拆小。
- 不要在一个 Issue 里同时做"修 bug + 重构 + 新功能"；行为保持型重构单独开 Issue。
- 每个验收项都应该能被一个检查覆盖；整套回归作为 required check 最后跑一次（C4.8）。

## 4. 合法范围写法

- `paths` 只列真正需要改的文件/目录；不要用 `**` 当默认。
- 配套修改（调用点、类型、导入）要列进对应验收项的 paths，否则会被范围检查拒绝。
- 范围越宽，ready 阶段的越界复核越弱；能精确就不要宽。

## 5. 提交前自查

1. 任务卡能被解析：`hephi lint-task <bundle.json>`（或 `eval/check-task.mjs <task-dir> --dry-run`）。
2. 每个 acceptance 的 `check` 存在且为 test 类（构建类不能当验收）。
3. 每个 paths 都在合同 allowedPaths 内；没有受保护测试的未授权修改。
4. 失败时报告 blocked 的固定格式：卡住的验收项、每次改了什么、输出要点、判断原因、需要谁决定什么。
