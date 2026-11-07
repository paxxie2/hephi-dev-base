# HEPHI-PREREQ-R2 修复实施清单与验收测试

版本：`REMEDIATION-R1`  
状态：**全部 pending；仅供派工，不表示已修复或已验收。**  
起始基线：`main@5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`  
工作目录：`/Users/zm/dsh-instances/experiment/hephi-review`  
远端：`origin = git@github.com:paxxie2/super-agent-hephi-review.git`  
依据：`HEPHI-R2-independent-review.md` 的 F1–F3、文档一致性问题及验证边界。

## 0. 范围、顺序与完成定义

### 0.1 本轮范围

| 编号 | 工作包 | 对应问题 | 本轮出口 |
| --- | --- | --- | --- |
| R0 | 冻结基线、文件边界和验收命令 | 防止范围蔓延 | `plan.lock.json` 由用户或独立会话冻结 |
| R1 | activation 规范化哈希 | F2／P5 | v2 新合同规范化；v1／无版本旧合同只读兼容；正负例通过 |
| R2 | 拒绝 dirty 构建 | F3／P2 | dirty、缺 commit 负例真实失败；干净提交与无 git 显式 commit 路径可复现 |
| R3 | 不可变部署、自动回滚和健康门禁 | F1／P8，兼补 P2 部署元数据 | 假宿主故障测试全过；真实宿主验收按证据独立签收 |
| R4 | 文档与索引同步 | 审计第 5 节 | 不再出现当前 SHA、PR、测试数和 smoke 状态矛盾 |
| R5 | 全量复跑与独立验收 | R0–R4 | 指定 Node 版本、代码测试、部署负例、diff 范围和证据链全部通过 |

### 0.2 不在本轮代码修复范围

- 不重写 P3 跨进程日志锁或告警通道；不实施 P4 super-agent 工具／Skill 隔离。
- 不补做 G1 全部探针、G2 人类审查、P6 性能对比、P7 干净机器、P9–P15 外部资源验收。
- 不启动 B5 有度量试跑或正式实验，不清理 site-pnl 的旧功能 PR。
- 不直接修改 `main`，不强推、不移动 `hephi-baseline-1`，不覆盖历史证据。

这些项继续阻塞对应原门槛；本轮 R1–R5 完成不等于 HEPHI-PREREQ-R2 全部完成。

### 0.3 依赖顺序

```text
R0 → R1 → R2 → R3 → R4 → R5
```

R1 与 R2 可在两个独立工作树并行，但合入顺序固定为 R1、R2、R3。R3 必须在干净提交上构建，否则 R2 会按设计拒绝发布构建。

### 0.4 每个工作包的完成条件

必须同时具备：

1. 实现落在允许文件清单内，未改变受保护文件。
2. 新增正常、负例和回归测试真实运行成功，保留退出码与原始输出。
3. 测试没有通过删除旧断言、提高超时或跳过负例获得通过。
4. 文档只写当前证据支持的结论；实载、真实宿主和外部资源未验证项继续明示。
5. 非实现者按最终提交独立复跑；实现者自测不能替代独立验收。

---

## R0｜冻结基线、文件边界与验收纪律

### R0.1 预检

- [ ] 在上述工作目录执行 `git fetch origin`，确认 `origin/main` 仍为 `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`；若已前移，记录新 SHA、审查新增 diff，并重新冻结本计划。
- [ ] 从已审 `origin/main` 新建修复分支 `agent/hephi-r2-remediation`；不得直接在 `main` 上提交。
- [ ] 确认 `hephi-baseline-1^{}` 仍为 `3f276a533bceaa63f3e43ff8d0d1e75af9dac8c8`，不得移动。
- [ ] 确认 Node 可切换到 `22.19.0`，pnpm 为 `11.7.0`；版本不符只阻塞最终验收，不得隐瞒。
- [ ] 保存当前 `git status --short`、`git branch --show-current`、`git rev-parse HEAD` 和远端回读。

### R0.2 允许修改文件

```text
hephi/src/control/activation.ts
hephi/tests/control/activation.test.ts
hephi/docs/versioning.md
hephi/tsdown.config.ts
hephi/tests/control/build-commit.test.ts                 # 新增
scripts/host/deploy-hephi.sh
scripts/host/test-deploy-hephi.mjs                       # 新增
hephi/tests/control/deploy-script.test.ts                # 新增
docs/implementation-index.md
docs/self-check-2026-11-07.md
docs/p8-deploy-record.md
docs/p8-race-record.md
docs/p11-hephi-smoke-record.md
docs/source-consistency.md
docs/remediation-r1-validation.md                        # 新增，最终验收时生成
```

若实现证明还必须修改其他文件，先停下申报；不得先改后补授权。

### R0.3 受保护文件

```text
hephi/src/control/evidence-verifier.ts
hephi/src/control/check-runner.ts
hephi/src/control/check-store.ts
hephi/src/control/worker-mount.ts
hephi/src/control/decision-log.ts
hephi/tests/control/evidence-verifier.test.ts
hephi/tests/control/plugin-version.test.ts
hephi/tests/control/decision-log.test.ts
hephi/tests/control/worker-mount.test.ts
```

### R0.4 冻结与独立验收

在目标仓库外生成 `plan.lock.json`，`base_commit` 使用完整起始 SHA，`allowed_files` 和 `protected_files` 使用上述清单。验收命令至少包含：

```bash
cd hephi && pnpm check
node scripts/host/test-deploy-hephi.mjs
git diff --check 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1..HEAD
```

由用户或独立会话运行冻结脚本并保存 `PLAN_HASH`。交付后由独立会话运行范围、保护文件和验收命令核对；模型自行保存的哈希和自行签收不算独立验收。

**R0 回滚点**：基线或文件范围不能冻结时，不修改产品代码。

---

## R1｜activation 规范化哈希与旧合同兼容

### R1.1 固定设计决策

- [ ] 将新写入的 activation 格式升为 `version: 2`。哈希算法变化会改变合同身份，不能只改实现而不登记版本。
- [ ] 新合同使用递归规范化 JSON：所有普通对象的键按明确规则排序，数组顺序保留，空白不参与哈希，语义相同的嵌套对象得到相同字节。
- [ ] 不排序数组，不把数字转成字符串，不改变 `null`／布尔值语义，不对路径或 Issue 文本做 Unicode 归一化。
- [ ] `version: 1` 和无版本历史合同继续使用原 `JSON.stringify` 原始键序哈希验证；保持原字节和原 `contractHash`，不得批量重算或原地迁移。
- [ ] 未知版本仍拒绝；错误信息要求“用当前插件重新 prepare 新合同，不要手改 stored hash”。
- [ ] 保留“先验证 stored hash，再解释 executionMode／enforcement”的顺序，避免把被篡改字段当成有效模式。
- [ ] 不取消未知顶层字段拒绝，不改变 legacy `plugin` 例外的现有口径；该例外仍需负责人单独确认。

### R1.2 实现步骤

- [ ] 在 `activation.ts` 中分离两个明确函数：当前规范化哈希和历史原始哈希；禁止调用方自行猜测旧合同算法。
- [ ] `prepareActivation()` 写 `version: 2`，使用规范化哈希生成 `contractHash`。
- [ ] `parseActivation()` 按原始 `version` 选择验证算法：`2` 用规范化；`1`／缺失用历史算法；其他值在 stored hash 核对后给出不支持版本及迁移指引。
- [ ] 所有内部新合同调用点统一走当前算法；测试构造 v1／无版本合同时必须显式使用历史算法，不得通过放宽断言绕过。
- [ ] 在 `versioning.md` 登记 v1／v2 矩阵、规范化规则、数组规则、旧合同只读兼容和重新 prepare 的迁移方式。
- [ ] 保留旧合同原文件与哈希证据；任何迁移都生成新文件和新 hash，并记录旧新关联。

### R1.3 自动化测试

在 `activation.test.ts` 增加，不删除既有测试：

| 用例 | 操作 | 必须结果 |
| --- | --- | --- |
| R1-T01 顶层键序 | 对语义相同、顶层键顺序不同的对象算当前哈希 | 哈希相同 |
| R1-T02 嵌套键序 | `plugin`、`verification`、嵌套 acceptance 对象分别重排键 | 哈希相同 |
| R1-T03 数组语义 | 交换 `allowedPaths` 或 acceptance 数组项顺序 | 哈希不同，不擅自把数组当集合 |
| R1-T04 语义篡改 | 修改 `baseSha`、模式、路径或检查参数 | 哈希不同；stored hash 不变时加载拒绝 |
| R1-T05 新合同 | prepare 后读取原始 JSON | `version=2`；规范化重算一致；格式化空白不改变可验证性 |
| R1-T06 v1 兼容 | 构造真实原始键序 v1 合同和历史 hash | 原样加载，字段与 hash 不变 |
| R1-T07 无版本兼容 | 构造无版本 legacy 合同和历史 hash | 原样加载，不自动升版、不改文件 |
| R1-T08 禁止静默迁移 | 将 v1 文件重排键并换成规范化 hash | 必须按 v1 历史算法拒绝；不得按 v2 接受，也不得原地升级旧文件 |
| R1-T09 未知版本 | `version=3`，stored hash 按历史规则正确 | 拒绝并给重新 prepare 指引 |
| R1-T10 未知字段 | 添加影响判定的未知字段并重算对应 hash | 仍拒绝 |
| R1-T11 模式篡改顺序 | 写入非法模式且 hash 失效 | 先报 hash mismatch，不使用非法模式 |
| R1-T12 独立夹具 | 对含嵌套对象、数组、中文和空格的固定 JSON 算哈希 | 与独立实现预先登记的预期 SHA256 完全一致 |

R1-T12 的预期值不得由被测函数在运行时自算。可用 Python 独立实现按已登记规则生成一次，连同输入字节和算法说明写入测试审查记录。

### R1.4 验收命令与证据

```bash
cd hephi
pnpm exec vitest run tests/control/activation.test.ts
pnpm typecheck
```

归档：测试输出、v2 合同样例、v1／无版本只读样例、独立夹具字节、预期 SHA256、实际退出码。

**R1 回滚点**：任何旧合同被改写、旧 hash 无法加载或键序测试不符合定义时，撤回 R1；不得通过删除旧合同或更新其 stored hash 制造通过。

---

## R2｜dirty 构建拒绝与可复现构建身份

### R2.1 实现步骤

- [ ] 修改 `tsdown.config.ts`：`git status --porcelain` 非空时立即抛出明确错误，列出“提交或清理工作树后再构建”的修复动作。
- [ ] dirty 判断覆盖已跟踪修改、暂存修改和未跟踪文件；忽略规则按 Git 原生行为，不能自行过滤 `DIRTY_PROBE` 之类文件。
- [ ] 有 `.git` 时以 `git rev-parse HEAD` 的完整 40 位 SHA 为唯一提交来源；`HEPHI_BUILD_COMMIT` 不得覆盖 dirty 错误或替换有效 Git HEAD。
- [ ] 无 `.git` 且未提供 `HEPHI_BUILD_COMMIT` 继续失败；提供时校验完整 40 位十六进制 SHA，拒绝 `unknown`、短 SHA、空白和任意字符串。
- [ ] 干净构建继续返回完整 SHA；`describePlugin()`、prepare 合同和检查记录的现有贯通逻辑不变。
- [ ] 在 `versioning.md` 将“`<sha>-dirty` 可构建”的旧说明改为“dirty 直接失败”，并写明无 git 源码归档的显式元数据路径。

### R2.2 自动化测试

新增 `build-commit.test.ts`，通过模块 mock 或隔离子进程覆盖配置加载，不修改当前审查仓库工作树：

| 用例 | 输入 | 必须结果 |
| --- | --- | --- |
| R2-T01 干净 Git | HEAD 为完整 SHA，porcelain 为空 | 返回该完整 SHA |
| R2-T02 已跟踪 dirty | porcelain 返回 ` M file` | 抛错，不产出构建 |
| R2-T03 暂存 dirty | porcelain 返回 `M  file` | 抛错 |
| R2-T04 未跟踪 dirty | porcelain 返回 `?? probe` | 抛错 |
| R2-T05 环境变量绕过 | dirty 同时设置有效 `HEPHI_BUILD_COMMIT` | 仍抛错 |
| R2-T06 无 git 无变量 | Git 调用失败，变量缺失 | 抛错且不含静默 `unknown` |
| R2-T07 无 git 显式变量 | Git 调用失败，变量为完整 SHA | 接受该 SHA |
| R2-T08 非法显式变量 | 短 SHA、`unknown`、空字符串、非十六进制 | 全部拒绝 |

### R2.3 真实负例

必须在独立克隆或工作树中执行，不在交付仓库故意留下脏文件：

```bash
git clone --shared <交付仓库> <独立dirty副本>
cd <独立dirty副本>
# 新增一个未跟踪探针文件后：
cd hephi
pnpm install --frozen-lockfile
pnpm build
```

预期：`pnpm build` 非零、错误明确指出 dirty、没有可用于发布的构建。随后删除探针并恢复干净，在同一提交再跑 `pnpm build`，预期成功且 `describePlugin().commit` 等于完整 HEAD。

另测无 git 源码归档：无变量失败；提供完整 SHA 成功。保存两种退出码和 `describePlugin()` 输出。

**R2 回滚点**：若团队确实需要 dirty 开发构建，必须另提开发／发布模式设计并重新评审；不得在本轮重新引入静默 `-dirty` 发布路径。

---

## R3｜不可变部署、自动回滚、健康与元数据门禁

### R3.1 先固定部署不变量

实现前把下列不变量写入脚本注释和测试：

1. `releases/<fullSHA>/` 一旦发布成功，其 `lib/` 与 `meta.json` 永不改写。
2. 构建目录与实载目录分离，构建不得通过实载 symlink 修改历史 release。
3. 实载切换只指向已完整发布且校验通过的 release；target 缺失、SHA 不符或哈希不符不得停止当前宿主。
4. 切换后的任何重启或健康失败都自动恢复 previous，并再次做健康检查。
5. 回滚也失败时保持 `paused=true`、非零退出、保留现场和双份健康证据，不自动接新任务。
6. 有进行中 Ticket、未知状态或未排空资源时禁止升级；删除 `--allow-open-tickets` 绕过入口。
7. 所有健康必需项 ready、实载元数据核对完成后，才允许操作者手动恢复派发。
8. 文件哈希只证明磁盘内容，不等于实载 commit；没有真实实载回读时，真实 P8 验收保持未通过。

### R3.2 构建与不可变发布

- [ ] 将构建移到独立临时目录：从指定完整 SHA 用 `git archive` 导出干净源码，再执行冻结安装、检查和构建。不得在实载 `$hephi/lib` 上直接构建。
- [ ] 临时构建目录必须位于独立工作根，成功后清理，失败时保留必要日志后清理；不得删除共享缓存或他人目录。
- [ ] 发布先写 `releases/.incoming-<sha>-<pid>`，完整复制构建并生成临时元数据，校验后再发布到最终目录。
- [ ] 用原子锁目录或等价机制保证单发布者；锁内再次检查最终 `releases/<sha>` 不存在。已存在时非零退出，不得执行 `rm -rf releases/$sha/lib`。
- [ ] 同 SHA 再次构建不得覆盖；若确需部署已有 release，走 `--target <sha>` 的只读校验与切换路径。
- [ ] `meta.json` 至少记录：`pluginCommit` 完整 SHA、`sourceTree`、构建入口 SHA256、构建时间、构建命令、`hostVersion`、记录格式版本。
- [ ] 新增必需参数 `--host-version <非空单行值>`；真实部署、dry-run 和 rollback 均要求提供。缺失或空值在构建／停止宿主前失败。该值来自固定宿主配置快照，不得编造。

### R3.3 target／previous 与实载切换

- [ ] 支持 `--target <40sha>`：只使用已存在的不可变 release，先核对目录名、meta.commit、入口 SHA256 和实际文件。
- [ ] 支持 `--previous <40sha>`：显式指定失败时恢复的 release；同样先校验。未提供时只能从当前实载指针可靠解析，解析失败则拒绝切换。
- [ ] 构建目录与实载分离后，将 `$hephi/lib` 迁移为指向 `releases/<sha>/lib` 的版本指针。首次从普通目录迁移只能在完全暂停、已快照的状态下进行。
- [ ] 后续切换使用同文件系统的新临时 symlink + 单次 rename；不得先删除当前指针再创建新指针。
- [ ] 记录切换前 target／previous、实载指针、入口哈希和快照。不得只依赖一个可被后续部署覆盖的 `last-snapshot`。
- [ ] `--rollback` 必须恢复到明确 target release，不得默认取“最近快照”这种随时间变化的目标。
- [ ] 保留现有 dry-run 能力：只读检查、构建和故障前验证，不切换指针、不杀进程、不重启。

### R3.4 自动回滚与健康检查

- [ ] 将“切换后失败”集中到一个不可绕过的错误路径：恢复 previous 指针 → 重启 → 全量必要健康检查 → 写回滚记录 → 非零退出。
- [ ] 构建失败、target 校验失败发生在切换前时，保持当前实载不变；若首次迁移已开始，则按切换后失败处理。
- [ ] 健康检查参数显式列出必要服务。实验 B 至少覆盖 `runtime relay notice launch delivery assessment reply evals models github`；缺失、`starting`、`error`、超时都视为失败。
- [ ] 不能只检查 `health.runtime.state`。部署记录中的最终 `after` 必须证明上述每项均为 ready。
- [ ] 回滚失败时保留当前指针、previous 指针、两次错误、宿主状态与日志，脚本非零并保持暂停。
- [ ] 脚本成功退出也不自动取消暂停；由操作者核对实载后通过现有 API 恢复，并记录恢复后的完整健康和 load。

### R3.5 排空与真实实载的边界

- [ ] 当前 `running=0、queued=0` 继续检查，但不得声称覆盖了启动预留、effect、Job、子 Agent 和 unknown。
- [ ] 对照 G1 已确认的真实 API 逐项接入排空检查；任一字段无法读取或语义未知，结果为 `blocked/unverified`，不得默认 0。
- [ ] `describePlugin()` 或等价实载入口存在时，部署后必须回读 target commit；不存在时，脚本可完成磁盘切换测试，但真实 P8 不得标 done。
- [ ] 暂停期间 Trigger 只持久化、不提前启动的既有记录保留；重复 PR 来源未确认，不得写成已证明的 Worker 重复执行。

### R3.6 假宿主自动化测试

新增 `test-deploy-hephi.mjs` 和 `deploy-script.test.ts`。测试只能使用临时目录、假 start 脚本、假状态响应和临时 Git 仓库，不访问 3082／3083，不调用真实 Issue／PR。

| 用例 | 故障／操作 | 必须断言 |
| --- | --- | --- |
| R3-T01 首次发布 | 从干净提交构建 A | release A 完整；实载指向 A；meta 字段齐全 |
| R3-T02 同 SHA 重发 | 在 release A 放哨兵后再次发布 A | 非零；哨兵、lib、meta 字节不变；未重启 |
| R3-T03 target 缺失 | 指定不存在 SHA | 切换前失败；当前指针与进程不变 |
| R3-T04 SHA 不符 | meta.commit 与目录名不符 | 拒绝；不停止宿主 |
| R3-T05 内容篡改 | 修改 release 入口但不改 meta | 哈希校验失败；不切换 |
| R3-T06 正常切换 | A → B | 只读使用 release B；A 的哈希不变；实载为 B |
| R3-T07 顺序回切 | B → A | 两个 release 均不变；实载为 A |
| R3-T08 重启失败 | B 重启注入失败 | 自动恢复 A；再次健康检查；脚本非零；paused=true |
| R3-T09 健康失败 | B 的 github=starting 或 reply=error | 自动恢复 A；不得因 runtime=ready 判成功 |
| R3-T10 回滚也失败 | B 失败后，A 恢复也失败 | 非零；paused=true；保留两次错误和现场 |
| R3-T11 dry-run | 指定 target／构建 | 不切换、不杀进程、不重启；输出明确 dry-run |
| R3-T12 进行中 Ticket | open Tickets >0 | 拒绝；无构建切换和重启 |
| R3-T13 绕过入口 | 传 `--allow-open-tickets` | 作为未知参数拒绝，不发生副作用 |
| R3-T14 hostVersion 缺失 | 不传或传空值 | 构建／停止宿主前失败 |
| R3-T15 排空状态 | running、queued、启动预留、effect、Job、子 Agent、unknown 分别非零／未知 | 各项分别拒绝；API 无字段记 unverified，不按 0 |
| R3-T16 不可变总校验 | 完成上述全部场景后重算 A／B release | 与操作前 SHA256 完全一致 |
| R3-T17 记录完整 | 成功、失败、回滚各一条 | target／previous、hostVersion、健康、暂停、时间、退出结果完整 |

### R3.7 真实宿主验收

仅在假宿主测试全绿、代码已提交、独立审查允许后执行：

1. 固定两个干净构建 A、B 及其完整 SHA、sourceTree、入口哈希和 hostVersion。
2. 暂停并排空；记录所有可获得的真实排空字段和不可获得项。
3. A → B：回读实载 commit、全部必要健康、当前指针、release 哈希和日志。
4. B → A：重复同样证据，确认上一 release 未被改写。
5. 注入一次可恢复的健康失败，确认自动回滚与再次健康检查；不注入无法安全恢复的故障。
6. 在暂停期间创建一次受控 Issue，确认 Trigger 持久化、无新 Ticket／Worker；恢复后只处理一次。产物标 `SMOKE_ONLY / NOT_FOR_METRICS`。
7. 全部结束后由操作者手动恢复，记录完整健康、load 和清理结果。

若实载 commit 无入口，第 3、4 项只能记磁盘切换证据，P8 真实验收保持 `unverified`；不得用“进程 ready + 文件 hash”替代。

**R3 回滚点**：自动回滚失败保持暂停并人工接管；不删除 release、不覆盖失败日志、不带新任务继续运行。

---

## R4｜文档与索引同步

仅在 R1–R3 实际证据产生后修改文档，不提前写“已修复”。

### R4.1 `implementation-index.md`

- [ ] 当前 main 改为最终真实合并 SHA；合并前列修复分支和 PR，不虚构 main。
- [ ] PR 清单补 #19，并追加本轮 PR 的真实编号、状态和 merge commit。
- [ ] 测试数从当前最终运行输出填写；保留历史 175／176 的时点说明，不与当前 180 或新值混写。
- [ ] 增加本轮修复文档、测试和运行证据索引；未入库产物继续只记路径与 SHA256。

### R4.2 `self-check-2026-11-07.md`

- [ ] 顶部增加“当前状态以最终合并段为准”的链接。
- [ ] L4／L6／L7 等历史限制保留原发现时点，但逐项标注后续修复提交与当前剩余限制，不能同时一处写“未修”、另一处写“已修”而无日期。
- [ ] 结论的测试文件数、测试数、Node／pnpm 版本和运行时间使用同一次最终输出。
- [ ] 21 节点状态只根据真实验收调整；本轮 R1–R3 代码完成不自动把 P2／P5／P8 写成真实验收 done。

### R4.3 其余文档

- [ ] `p11-hephi-smoke-record.md`：删除或更正末尾“PR 合并未做”的过期句，保留 PR #42 已合并及后续 smoke 限制。
- [ ] `p8-race-record.md`：结论改为“存在来源未确认的外部重复产物；本 Worker 重复执行未证实”，不得写成确定的 Worker 缺陷。
- [ ] `p8-deploy-record.md`：追加本轮不可变、自动回滚、全健康和实载验证结果；保留旧记录中 `github=starting` 的原始事实。
- [ ] `source-consistency.md`：更新当前 main、修复分支、构建和实载状态；历史 HEAD 继续标明历史时点。
- [ ] 新建 `remediation-r1-validation.md`，逐条填写下述验收矩阵的实际命令、退出码、证据路径、复核者和局限。

**R4 回滚点**：文档证据不足时回退状态表述，不修改原始运行日志或历史数字来迎合结论。

---

## R5｜全量验收与交付

### R5.1 实现者预检

在提交前可运行：

```bash
cd hephi
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
node ../scripts/host/test-deploy-hephi.mjs
```

注意：R2 实施后，未提交 dirty 工作树的 `pnpm build` 应当失败。因此最终 `pnpm check` 必须在已提交、干净工作树上运行，不能用环境变量绕过。

### R5.2 最终干净树复跑

固定 Node `22.19.0`、pnpm `11.7.0`，记录实际版本：

```bash
cd hephi
pnpm install --frozen-lockfile
pnpm check
cd ..
node scripts/host/test-deploy-hephi.mjs
git diff --check 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1..HEAD
git status --short
```

另对全部 `.mjs` 执行 `node --check`，全部 `.sh` 执行 `sh -n`。若新增其他可执行文件，纳入对应语法检查。

### R5.3 必须通过的验收矩阵

| 编号 | 验收项 | 通过条件 | 证据 |
| --- | --- | --- | --- |
| R5-A01 | 基线 | 起始提交、最终提交、分支、远端和标签均可回读 | Git 原始输出 |
| R5-A02 | 范围 | 最终 diff ⊆ allowed_files；受保护文件哈希不变 | 独立验收输出 |
| R5-A03 | R1 规范化 | R1-T01–T12 全过，旧合同原样可读 | 测试与合同样例 |
| R5-A04 | R2 dirty | R2-T01–T08 及真实 dirty 负例全过 | 退出码与构建输出 |
| R5-A05 | 干净构建 | 完整 SHA 注入，describePlugin／合同／检查记录一致 | 构建与工单元数据 |
| R5-A06 | 不可变性 | R3-T02／T16 证明 release 从未被覆盖 | 前后 SHA256 |
| R5-A07 | 自动回滚 | R3-T08–T10 全过，失败保持暂停 | 假宿主原始记录 |
| R5-A08 | 全健康 | `starting/error/缺失` 均不通过，必要服务全部 ready 才通过 | 健康响应与日志 |
| R5-A09 | 真实切换 | A→B→A 实载 commit 正确，或明确保持 unverified | 实载回读与部署证据 |
| R5-A10 | 文档一致 | 无旧 SHA、PR 遗漏、测试数和 smoke 合并状态矛盾 | 文档 diff 与复核 |
| R5-A11 | 全量测试 | 指定 Node 版本下 `pnpm check` 全过 | 原始完整输出 |
| R5-A12 | 未验证边界 | G1／P3／P4 等未被本轮冒充完成，B5 未启动 | 最终状态表 |

### R5.4 独立验收交付格式

交付时必须填写：

```text
起始提交：
最终提交／PR：
实际修改文件及逐项原因：
受保护文件哈希核对：
实际执行的命令、时间和退出码：
Node／pnpm 版本：
自动化测试结果：
真实 dirty 负例结果：
假宿主部署故障结果：
真实宿主 API 级结果：
实载 commit 回读结果：
未验证项与阻塞项：
是否超出本清单：
最终 diff 与证据目录：
```

独立验收者必须从最终提交重新克隆，不直接使用实现者工作树；核对文件范围、测试、负例、日志和文档。任何 `planned` 测试脚本未交付、未运行或无法复现时，对应项不得标 done。

---

## 后续仍须保留的门槛

即使 R5 全部通过，也只关闭本轮修复项：

- P2 的完整 done 仍要求真实双构建、合同、检查记录、部署、hostVersion 和实载 commit 对齐。
- P5 的完整 done 仍要求真实 prepare／挂载拒绝不支持版本，以及进行中赫菲工单升级保护通过。
- P8 的完整 done 仍要求真实排空、实载回读、健康、故障回滚和暂停竞态证据。
- P3、P4、G1、G2 人类独立审查、P6–P15 外部依赖按原清单继续执行。
- GATE-B5-PILOT 和 FORMAL 在原硬依赖全部满足前不得放行。

最终状态只能使用 `pending／running／done／blocked／failed／unverified`，不得以“代码已合并”替代“验收已通过”。
