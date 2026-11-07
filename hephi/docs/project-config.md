# 项目配置约定（C4.6 / C4.8 / C1 / C2）

状态：**约定与提议（未实现 / 未全部实现）**。本文件规定项目侧配置口径与后续实现字段；
**本轮没有修改插件代码或任务卡格式**。逐节标注「已实现 / 待实现」；未标注实现的均为提议，
不得在验收记录里写成已生效。

| 节 | 主题 | 当前状态 |
| --- | --- | --- |
| §1 | C4.6 检查环境固定 | **约定**（项目侧执行；check-task 校验扩展待实现） |
| §2 | C4.8 聚焦检查 | **约定**（lint-task 已有基础校验；聚焦提示规则待实现） |
| §3 | C1 受保护验收资产 | **提议，待实现（C1）** |
| §4 | C2 未覆盖改动提示 | **约定 + 项目侧示例**（赫菲不解析覆盖率；集成待实现） |
| §5 | 覆盖提示输出格式 | 示例脚本已按此格式输出；赫菲消费/展示待实现 |

实现依据：`ROADMAP-95.md` §4.10 C1/C2/C4.6/C4.8；字段命名沿用
`hephi/docs/versioning.md`/`decisions-format.md` 的登记风格。

## 1. C4.6 检查环境固定（约定）

目标：让检查在**可重复、离线、锁版本**的环境里运行；检查结果不得依赖运行时的网络/浮动版本。

### 1.1 项目必须满足

| 项 | 约定 |
| --- | --- |
| 依赖锁 | 仓库提交锁文件（`package-lock.json`/`pnpm-lock.yaml`/`poetry.lock`/`requirements.txt` 固定版本等），检查前不更新锁文件 |
| 离线安装 | Node：`npm ci --offline` 或 `pnpm install --frozen-lockfile --offline`；Java：Maven `mvn -o`（本地仓库已预热）或 Gradle `--offline`；Python：从已固定 wheels 安装 |
| 检查命令 | `verification.checks[].command/args` 不得包含联网步骤（`git clone`、下载依赖、访问 registry）；必要时用项目脚本封装离线约束 |
| 工具链版本 | JDK/Node/Python 版本在任务卡或项目配置中固定并记录；检查脚本可断言实际版本 |
| 可复现输入 | 不读取外部可变文件/环境变量；入口使用相对 `cwd`，不写仓库外路径 |
| 失败语义 | 离线依赖缺失/版本不符必须**非零退出**（fail-closed），不得跳过或回退到联网 |

### 1.2 与 `check-task` 的关系（B2）

`eval/check-task.mjs` 当前校验：任务结构、base 上隐藏测试失败、参考修复通过（3 次一致）、
参考修复不越 allowedFiles；**不校验离线/锁版本**。约定为后续扩展：

- 在 `task.json` 增加可选 `environment` 块（提议字段）：
  ```json
  "environment": {
    "offline": true,
    "lockfile": "pnpm-lock.yaml",
    "toolchain": { "node": "22.19.0", "java": "17" },
    "install": "pnpm install --frozen-lockfile --offline"
  }
  ```
- `check-task` 扩展校验（待实现）：
  1. `offline=true` 时检查 `install` 命令含离线标志，且不含网络命令；
  2. 锁文件存在且与 base 一致（不得在复核中被更新）；
  3. 工具链版本可被验证（至少记录）；不满足则任务无效（exit 1）。
- 在这些扩展实现前，C4.6 只能作为**项目自检约定**，不能声称 `check-task` 已强制。

## 2. C4.8 聚焦检查（约定）

目标：验收项只跑相关测试，整套回归最后跑一次；减少每次 ready 的检查成本，同时不牺牲整体回归。

### 2.1 配置约定

1. **每个验收项绑定相关检查**：`task.acceptance[].check` 指向一个 `kind: "test"` 的检查；
   多个验收项可引用同一检查（ready 每个检查只运行/核验一次）。
2. **整套回归作为一个 required check**：例如 `full-regression`（`kind: "test"`、`required: true`），
   在集成完成后运行一次；不要在每个验收项里重复整套回归。
3. **检查命名**：聚焦检查用可读 id（如 `unit-<module>`），整套回归用固定 id；
   业务验收项指向 `kind: "test"` 的聚焦检查，构建检查不能充当验收项。
4. **执行顺序**：按验收项边改边跑聚焦检查；全部集成后再跑一次 `full-regression`；ready 时核验
   所有 required 检查与验收项引用的检查证据。
5. **项目选择**：整套回归是否 required、聚焦检查粒度由项目在配置里决定；赫菲只校验引用与证据。

### 2.2 `lint-task` 提示规则

`hephi lint-task`（C5，已实现）当前校验：任务卡 schema、ticketId、allowedPaths 相对路径、
checks 结构、验收项引用存在的 **test** check、重复 id；并对 acceptance>8、allowedPaths>50 给提示。
以下为**待实现**的聚焦检查提示（只提示，不拦截）：

| 规则 id | 触发 | 级别 |
| --- | --- | --- |
| `focus.no-test-check` | 验收项引用的检查 `kind != test`；或任务卡没有任何 test check | 提示 |
| `focus.too-many-required` | required 检查数 > 5（项目可自定义阈值） | 提示 |
| `focus.no-regression` | 没有任何名为/标注为整套回归的 required check（项目可声明豁免） | 提示 |
| `focus.regression-per-item` | 多个验收项引用同一个“整套回归”检查（应只在集成后跑一次） | 提示 |
| `focus.too-many-acceptance` | acceptance > 8（现有 lint-task 已提示） | 提示 |
| `focus.wide-scope` | allowedPaths > 50（现有 lint-task 已提示） | 提示 |

> 注意：`lint-task` 是**离线提示工具**，不替代 prepare/ready；提示不改变合同或拦截行为。

## 3. C1 受保护验收资产（提议，待实现）

> **本节是字段与优先级提议，插件当前未实现。** 在实现并登记版本前，现行行为不变：
> 已有测试默认受 `protect` 保护（常见测试路径），删除被拒；受保护资产清单未生效。

### 3.1 目标（ROADMAP §4.10 C1）

- 保护项目/Issue 作者**指定**的关键验收测试，不再默认把所有已有测试都当成不可修改；
- 清单内文件被修改/删除/迁移必须由**某个验收项授权**，否则拒绝；
- 清单外的已有测试：**删除仍按现有规则拒绝**；修改只记录、不拦截；
- 项目可扩大清单到所有已有测试，但必须测误拦率与副作用（Worker 反复申请扩大范围、或新增重复测试绕开限制）。

### 3.2 提议字段

任务卡（`task`，Issue 内的 `hephi-task` JSON）新增**可选**字段；项目配置可提供默认清单：

```jsonc
{
  "version": 2,                        // 提议升版；v1 无这些字段，行为不变
  "protectedAssets": ["tests/acceptance/**", "spec/contract/**"],
  "acceptance": [
    {
      "id": "AC1",
      "text": "…",
      "check": "unit-price",
      "paths": ["src/price.js"],
      "authorizes": [
        { "path": "tests/acceptance/price.contract.test.js", "op": "modify" }
      ]
    }
  ]
}
```

- `protectedAssets: string[]`：仓库相对的**受保护验收资产**（glob；建议与 `protect` 使用同一路径语法）。
- `authorizes: [{ path, op }]`：
  - `path` 是仓库相对的**精确文件路径**（不支持 glob；便于审计“授权了哪个文件”）；
  - `op` ∈ `modify | delete | migrate`；`modify` 不隐含 `delete`/`migrate`，反之亦然。
- 生效清单 = 项目默认 `protectedAssets` ∪ 任务卡 `protectedAssets`（任务卡只能增加、不能缩小项目保护）。
- 授权必须写在**具体验收项**内；不允许任务卡级“全局授权”。

### 3.3 优先级规则（与计划审查 P1-5 的 C1 授权优先级一致）

按顺序判定，后者不能推翻前者：

1. **allowedPaths 优先**：任何授权都**不扩大** `allowedPaths`；目标不在 `allowedPaths` 内 → 直接拒绝
   （授权不能把范围外文件变成合法）。
2. **验收项范围优先**：授权目标还必须落在**授权所在验收项**的 `paths` 内；
   不在该验收项 `paths` 内 → 授权无效（防止“随便找个验收项挂授权”）。
3. **按操作精确匹配**：清单内资产被修改/删除/迁移时，必须有同一验收项、同一精确文件、同一 `op` 的授权；
   `modify` 授权不覆盖 `delete`，`migrate` 授权不覆盖 `modify`/`delete`；不跨验收项/文件/操作继承。
4. **未授权删除仍拒**：清单内资产的 `delete` 无匹配授权 → 拒绝（保持现行“删除测试被拒”的语义）。
5. **未授权修改/迁移仍拒**：清单内资产的 `modify`/`migrate` 无匹配授权 → 拒绝。
6. **清单外修改只记录**：不在生效清单内的已有测试/文件被修改 → 放行，但写决策日志
   `asset.modified`（**record-only**，不是 deny）；清单外**删除**仍按现行 `protect` 规则拒绝。
7. **授权也要审计**：授权生效时写决策日志（建议 `asset.authorized`），记录验收项 id、文件、op，
   便于事后人工复核；不改变 ready 通过条件（ready 仍要求检查/证据/范围一致）。
8. **不扩大范围**：授权只解决“该验收项改/删/迁移该受保护文件”的许可，不改变任务卡 paths、合同
   allowedPaths、检查命令或 ready 判定。

### 3.4 建议的决策日志规则（待登记 `decisions-format.md`）

| rule | 方向 | 说明 |
| --- | --- | --- |
| `asset.unauthorized-modify` | deny | 受保护资产修改无匹配授权 |
| `asset.unauthorized-delete` | deny | 受保护资产删除无匹配授权 |
| `asset.authorized` | allow | 授权命中的 record（审计用，可仅记录） |
| `asset.modified` | allow（record-only） | 清单外已有测试被修改，只记录 |

这些规则编号只是提议；实现前需在 `decisions-format.md` 登记并保持 `decisions.jsonl` 可追加兼容。

### 3.5 版本与兼容

- 任务卡新增字段改变格式语义，建议任务卡 **version 2**（`versioning.md` 登记）；v1 任务卡没有这些字段，
  行为与现行完全一致（受 `protect` 保护、删除拒绝）。
- 合同冻结任务卡后，授权随合同哈希一起冻结；prepare 之后不得手工改任务卡（与现有规则一致）。
- 未实现前，**不得**在任务卡里写 `protectedAssets`/`authorizes` 并期待生效；prepare 当前 task 卡
  schema 会拒绝未知字段（strict）。

### 3.6 验收方式（实现后）

- 未授权修改受保护资产 → 拒绝；授权后放行；清单外修改放行并记录；删除未授权仍拒；
  `modify` 授权不能用于 `delete`；授权不能越过 allowedPaths/验收项 paths。
- 开发集测量误拦率与副作用（重复申请扩大范围、新增重复测试绕开）。
- 在真实宿主 E2E（A5）前只能做机制测试；不得把机制通过写成真实验收通过。

## 4. C2 未覆盖改动提示（约定 + 示例）

### 4.1 定位与边界

- **定位**：找出没有被现有验收测试执行到的**可执行改动**，作为风险提示，写入改动摘要/审查材料。
- **不承担**：防止无关重构；被执行到 ≠ 有断言，也不等于改动必要；无关重构同样可能被完全覆盖。
- **实现归属**：项目提供检查脚本（本仓库提供 Node/Java 示例），**赫菲不解析覆盖率**；
  默认只提示，是否作为必需检查由项目决定。

### 4.2 项目侧约定

1. 项目在测试后生成覆盖率数据（istanbul/nyc JSON 或 JaCoCo XML），用示例脚本与 `git diff --unified=0`
   求交，输出 §5 格式 JSON；
2. 将 JSON 附到 PR/审查材料（或作为非必需的 `verification.checks` 项，先测误报）；
3. 不把覆盖率提示当作测试有效性证明，也不把“行被执行”当作“行为有断言”；
4. 提示脚本失败（工具/输入错误）必须显式失败；不得默认“无提示=已覆盖”。

示例：

- `hephi/examples/coverage-node/`（istanbul/nyc JSON + git diff；`--self-test` 已实测）
- `hephi/examples/coverage-java/`（JaCoCo XML + git diff；`--self-test` 已实测）

### 4.3 赫菲侧（待实现）

- 赫菲**不解析**覆盖率 JSON/XML；未来如需汇总，应把项目提供的 JSON 作为**不透明提示附件**
  （记录引用 path + sha256，不解释内容），默认只在摘要/决策日志中展示，不作为 ready 条件；
- 具体字段与展示位置待实现，本文不承诺行为。

## 5. 覆盖提示输出格式（约定）

项目脚本输出一个 JSON 对象（UTF-8、稳定键、无绝对路径）；Node/Java 示例均按此格式：

```json
{
  "schemaVersion": 1,
  "kind": "coverage-hint",
  "tool": { "name": "coverage-hint-node-example", "version": "0.1.0" },
  "generatedAt": "2026-11-07T00:00:00.000Z",
  "baseSha": "<40hex|null>",
  "headSha": "<40hex|null>",
  "changedFiles": 4,
  "uncovered": [
    { "path": "src/a.mjs", "lines": [4], "reason": "statement not executed by tests" },
    { "path": "src/b.mjs", "lines": [2], "reason": "no coverage entry; executable status unknown" }
  ],
  "summary": { "changedFiles": 4, "uncoveredFiles": 2, "uncoveredLines": 2 }
}
```

约定：

- `path` 必须是仓库相对路径；`lines` 为 **base 之后新文件行号**（升序、去重）；
- `reason` 是自由文本短句，说明“为什么是提示”（未执行/无覆盖率条目）；
- `uncovered` 为空表示**没有提示**，不表示改动已验证；
- 退出码：`0`=分析完成（无论是否有提示）；`1`=输入格式错误；`2`=用法/环境错误；
- 不写仓库文件（除显式 `--out`）；不包含 token/凭据/绝对路径；
- 该 JSON 是**提示**，不是赫菲合同/ready 证据，不能替代检查记录。

## 6. 待实现项与负责人决策

| 项 | 状态 | 需要谁 |
| --- | --- | --- |
| C4.6 离线/锁版本校验（check-task 扩展） | 待实现 | 负责人确认字段与阈值 |
| C4.8 聚焦检查提示规则（lint-task 扩展） | 待实现 | 负责人确认规则与阈值 |
| C1 `protectedAssets` / `authorizes` / 优先级 | **待实现（C1）** | 负责人批准字段与任务卡版本升版（建议 v2） |
| C1 决策日志新规则登记 | 待实现 | 与 `decisions-format.md` 同步 |
| C2 赫菲侧提示附件展示 | 待实现（可选） | 负责人确认展示位置与是否只记录 |
| 示例脚本生产化（大型报告、source map、多模块） | 项目侧 | 各项目自行集成 |

> 本文所有 C1/C2 及 C4.6/C4.8 的“扩展/提示”均为**提议或待实现**；当前插件行为仍以
> `hephi/README.md` 与 `hephi/src/` 为准，不得把本文当已实现规则使用。
