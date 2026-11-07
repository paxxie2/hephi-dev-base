# 持久格式版本化规则（P5）

状态：**规则已定稿；activation 版本化 v2（规范化哈希，v1／无版本只读兼容）与检查记录版本 3（含 pluginCommit）已实施，其余格式仍为 pending。**
适用范围：activation 合同、任务卡、检查配置、检查记录、`decisions.jsonl`、基线归档。
只规定规则；行为改动按本规则实施并带测试（activation 已实施）。

## 1. 版本矩阵

| 格式 | 载体 | 当前状态 | 升版条件 |
| --- | --- | --- | --- |
| activation 合同 | `activation.json` | 新合同 `version: 2`（规范化哈希）；`version: 1` 与无 version 的历史合同只读兼容（原始键序哈希） | 任何影响判定或挂载的字段变化 |
| 任务卡 | 合同内 `task` | 固定 1 | 影响拦截或验收判定的变化 |
| 检查配置 | 项目检查文件 | 待登记 | 判定语义变化 |
| 检查记录 | 每工单 evidence | 3（含 `pluginCommit`；v2 记录加载即拒绝） | 字段语义或判定条件变化 |
| `decisions.jsonl` | 每工单日志 | 1 | 字段或含义变化（仅追加写） |
| 基线归档 | `tickets.json`/`summary.json` | 1 | 导出字段或口径变化 |

## 2.1 activation 规范化哈希（version 2）

- 序列化：递归按对象键的 UTF-16 code unit 升序排序；数组保持原顺序（不排序、不当集合）；不输出空白（等价 `JSON.stringify` 的紧凑形式）。
- 语义保持：`undefined` 对象值被丢弃、数组中的 `undefined` 变为 `null`；数字按 JS `JSON.stringify` 规则输出；布尔与 `null` 不变；不对字符串做 Unicode 归一化，不改变路径或 Issue 文本。
- 版本 1 与无版本历史合同：继续用原始 `JSON.stringify` 键序计算哈希，保持原字节与原 `contractHash`；不得批量重算、不得原地迁移。
- 未知版本：先按历史算法核对 stored hash（防篡改），再拒绝并给出“用当前插件重新 prepare 新合同，不要手改 stored hash”的迁移指引。
- 校验顺序：先验 stored hash，再解释 `executionMode`／`enforcement`，最后拒绝未知顶层字段。
- 迁移方式：对旧合同重新执行 prepare 生成 `version: 2` 的新文件与新 hash；旧文件保留为只读证据，旧新关联记录在案。

## 2. 规则

1. 任何会改变判定结果的字段变化必须升版；只增加说明性字段可不升版，但必须在本文档登记。
2. 不支持的版本必须在 prepare 或挂载时明确拒绝，并给出可执行的迁移说明；禁止静默沿用旧行为。
3. 未知的顶层判定字段必须拒绝；新增字段先登记再解析。
4. 冻结合同在 prepare 后不可原地改写；哈希按规范序列化（键序固定、无多余空白）计算。
5. 有进行中的赫菲工单时禁止升级插件；不迁移运行中的工单，也不让旧记录在新插件下静默通过。
6. 每个后续改动持久格式的工作包必须写明版本变化与迁移说明。

## 3. 落实方式

- activation：`src/control/activation.ts` 写入 `version: 2` 并使用规范化哈希（`contractHash`）；`legacyContractHash` 仅供 v1／无版本合同校验。加载时按原始 version 选择算法，先校验 stored hash，再拒绝未知版本与未知顶层字段。测试见 `tests/control/activation.test.ts` 的「activation format versioning」「activation canonical hashing (R1)」（R1-T01–T12）。
- 检查记录：`version: 3` 增加 `pluginCommit`；ready 拒绝另一构建产生的证据并要求用当前构建重跑（`src/control/evidence-verifier.ts`）。v2 记录在 `readRuns` 加载时即被拒绝。
- 合同：无 `plugin` 字段的 legacy 合同不因构建不同被拒绝（P2 之前的合同），但其检查记录仍必须是当前构建产生的——这是已知的兼容例外，需人工确认是否符合“旧证据拒绝”口径。
- 插件构建身份：`tsdown.config.ts` 注入 `__HEPHI_COMMIT__`。**dirty 工作树（已跟踪／暂存／未跟踪任一）直接构建失败**，不产出可发布构建；`HEPHI_BUILD_COMMIT` 不能覆盖 dirty 的 Git HEAD。无 `.git` 的源码归档必须显式提供完整 40 位十六进制 `HEPHI_BUILD_COMMIT`，缺失或非法值同样失败；不存在静默 `unknown` 或 `-dirty` 发布路径。`describePlugin()` 返回 `{name, version, commit}`，prepare 合同冻结 `plugin: {version, commit}` 并纳入哈希。
- 其余格式（任务卡、`decisions.jsonl`、基线归档）：代码实施前，任何"已版本化"的结论不得写入验收记录。
- 活跃工单禁止升级由 P8 部署流程执行，不在本文件实现。
