# 持久格式版本化规则（P5）

状态：**规则已定稿；activation 版本化（version=1）与检查记录版本 3（含 pluginCommit）已按本规则实施，其余格式仍为 pending。**
适用范围：activation 合同、任务卡、检查配置、检查记录、`decisions.jsonl`、基线归档。
只规定规则；行为改动按本规则实施并带测试（activation 已实施）。

## 1. 版本矩阵

| 格式 | 载体 | 当前状态 | 升版条件 |
| --- | --- | --- | --- |
| activation 合同 | `activation.json` | 有 `version: 1`；无 version 的旧合同按 legacy 读取 | 任何影响判定或挂载的字段变化 |
| 任务卡 | 合同内 `task` | 固定 1 | 影响拦截或验收判定的变化 |
| 检查配置 | 项目检查文件 | 待登记 | 判定语义变化 |
| 检查记录 | 每工单 evidence | 3（含 `pluginCommit`；v2 记录加载即拒绝） | 字段语义或判定条件变化 |
| `decisions.jsonl` | 每工单日志 | 1 | 字段或含义变化（仅追加写） |
| 基线归档 | `tickets.json`/`summary.json` | 1 | 导出字段或口径变化 |

## 2. 规则

1. 任何会改变判定结果的字段变化必须升版；只增加说明性字段可不升版，但必须在本文档登记。
2. 不支持的版本必须在 prepare 或挂载时明确拒绝，并给出可执行的迁移说明；禁止静默沿用旧行为。
3. 未知的顶层判定字段必须拒绝；新增字段先登记再解析。
4. 冻结合同在 prepare 后不可原地改写；哈希按规范序列化（键序固定、无多余空白）计算。
5. 有进行中的赫菲工单时禁止升级插件；不迁移运行中的工单，也不让旧记录在新插件下静默通过。
6. 每个后续改动持久格式的工作包必须写明版本变化与迁移说明。

## 3. 落实方式

- activation：`src/control/activation.ts` 写入 `version: 1` 并纳入合同哈希；加载时先校验原哈希，再拒绝未知版本与未知顶层字段；缺失 version 的旧合同按 legacy 读取。测试见 `tests/control/activation.test.ts` 的「activation format versioning」。
- 检查记录：`version: 3` 增加 `pluginCommit`；ready 拒绝另一构建产生的证据并要求用当前构建重跑（`src/control/evidence-verifier.ts`）。v2 记录在 `readRuns` 加载时即被拒绝。
- 插件构建身份：`tsdown.config.ts` 注入 `__HEPHI_COMMIT__`（dirty 构建写成 `<sha>-dirty`，无 git 时必须提供 `HEPHI_BUILD_COMMIT`，否则构建失败）；`describePlugin()` 返回 `{name, version, commit}`，prepare 合同冻结 `plugin: {version, commit}` 并纳入哈希。
- 其余格式（任务卡、`decisions.jsonl`、基线归档）：代码实施前，任何"已版本化"的结论不得写入验收记录。
- 活跃工单禁止升级由 P8 部署流程执行，不在本文件实现。
