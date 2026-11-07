# b5-task-key-whitelist

## 任务
为 B5 validateTasks 的任务条目增加 taskId/repo/category 三字段白名单，拒绝未知字段；保留 array 与 {tasks: [...]} 输入、合法分类及重复 ID 拒绝。本任务为边界增强 fixture，并非已发生的生产故障。

## 验收
隐藏测试必须在固定真实 Git 基线上连续失败 3 次，应用参考补丁后连续通过 3 次。仅标准库，无安装、网络、模型或宿主访问。基线失败必须是目标断言失败，而非导入或依赖故障。

## 合法范围
仅 `eval/b5-plan.mjs`。不得改变其他产品文件、运行配置、Skill 或阶段策略。
