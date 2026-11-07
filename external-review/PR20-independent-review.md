# PR #20 独立复核报告

日期：2026-11-07  
审查提交：`17d3827d3a73d3afb7a3b8de130d1615bd351769`  
比较基线：`5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`  
审查方式：静态审阅、独立工作树复跑、隔离假宿主故障注入、独立 Git 克隆与源码归档构建。未修改产品源码，未访问真实宿主。

## 1. 结论

**Request changes：PR #20 当前不应合并，也不应进入 R3.7 真实宿主验收。**

- **R1（activation v2 哈希）**：代码层复核通过；包含在完整测试中，30 个 activation 用例通过。
- **R2（构建 commit 与 dirty 拒绝）**：代码层及独立真实路径复核通过；干净 Git、dirty Git、无 Git 缺变量、无 Git 显式完整 SHA 四种结果均符合方案。
- **R3（不可变部署与自动回滚）**：不通过。原假宿主套件 44 条断言全过，但新增的 5 组独立负例全部复现缺陷，其中首次普通目录迁移失败直接阻断现有环境部署。
- 若希望先落地 R1／R2，应拆成不含 R3 的独立 PR；**不能用当前整包 PR 部分批准的方式合并**。

原测试全绿只说明其覆盖场景通过，不覆盖本报告发现的失败路径。冻结计划的机械验收也为 PASS，但它只核对源码未改、`pnpm check` 和原 44 条断言，不能替代新增负例审查。

## 2. 实测摘要

| 项目 | 环境／命令 | 实际结果 |
| --- | --- | --- |
| 完整检查 | Node `v22.19.0`、pnpm `11.7.0`；`cd hephi && pnpm check` | exit 0；20 个测试文件／202 个测试通过；类型检查与构建成功 |
| 原假宿主套件 | `node scripts/host/test-deploy-hephi.mjs` | exit 0；44 条断言通过 |
| R2 独立 Git 克隆 | 干净提交构建 | exit 0 |
| R2 dirty 负例 | 未跟踪探针 + `HEPHI_BUILD_COMMIT` 覆盖值 | exit 1；明确拒绝 dirty 树，覆盖值不能绕过 |
| R2 无 Git 负例 | `git archive` 源码，无 commit 变量 | exit 1；明确要求完整 SHA |
| R2 无 Git 正例 | 同一归档 + 完整 SHA | exit 0；`describePlugin().commit` 等于审查提交完整 SHA |
| R3 独立负例 | 普通目录迁移、隐式 rollback target、无 current 恢复、恢复 rename 失败、paused 回读 | **5／5 缺陷均复现** |
| 冻结计划验收 | `verify_delivery.py` | PASS；源码改动 0 个文件；三条既定验收命令均 exit 0 |

证据入口：

- `evidence/pr20-independent/delivery-verification.log`
- `evidence/pr20-independent/fake-host-original.log`
- `evidence/pr20-independent/negative-tests.log`
- `evidence/pr20-independent/negative-tests.json`
- `evidence/pr20-independent/r2-independent.log`
- `evidence/pr20-independent/r2/`

## 3. 合并阻断项

### R3-F1｜首次从普通 `lib` 目录迁移必然在指针切换处失败

**级别：阻断。对应独立负例 N1。**

代码路径：

- `scripts/host/deploy-hephi.sh:130-138`：`snapshot_existing_lib()` 对普通目录只执行 `cp -R`，原 `$hephi/lib` 目录仍留在原地。
- `scripts/host/deploy-hephi.sh:122-128`：`set_pointer()` 随后把临时 symlink `renameSync` 到 `$hephi/lib`。
- `scripts/host/deploy-hephi.sh:280-284`：首次部署先快照，再直接调用上述指针切换。

实测从一个含 `legacy.mjs` 的普通 `hephi/lib/` 目录部署：

- 快照确实生成；
- `renameSync` 抛出 `EISDIR`；
- 脚本 exit 1；
- 原 `lib` 仍是普通目录，部署无法完成。

原测试在 `scripts/host/test-deploy-hephi.mjs:83-100` 只创建空的 `$hephi` 目录，没有创建普通 `lib/`，所以首次发布测试绕过了真实旧布局。旧部署文档则明确记录过直接操作普通 `lib` 目录的历史形态。

**必须修正**：暂停状态下为普通目录设计显式迁移事务。可在同一文件系统先把旧目录原子 rename 到迁移备份，再 rename 新 symlink；若第二步失败，必须恢复旧目录。单纯复制快照不足以让指针 rename 成功。

**必须补测**：普通目录首次迁移成功、迁移第二步失败时旧目录恢复、目标启动失败后能恢复旧快照；同时断言进程、指针、目录类型和记录。

### R3-F2｜`--rollback` 缺少 `--target` 时会隐式回滚到仓库 HEAD

**级别：高。对应独立负例 N2。**

`scripts/host/deploy-hephi.sh:228-230` 先把空 `target` 默认成 `git rev-parse HEAD`，到 `240-242` 才检查 rollback 参数。因此检查时的 `target` 已非空，无法识别调用者是否显式提供。

实测命令只提供 `--rollback --previous <A>`，不提供 `--target`：

- 脚本 exit 0；
- 指针从 A 切换到仓库 HEAD 对应的 B；
- 写入 `result=ok` 的 rollback 记录。

这违反清单 R3.3“rollback 必须恢复到明确 target release”的要求。

**必须修正**：在任何 HEAD 默认值解析之前，先判断 `rollback=yes && target 为空` 并非零退出；普通部署是否默认 HEAD 可与 rollback 分开处理。

**必须补测**：rollback 缺 target、target 为空字符串、target 非完整 SHA，均不得切换、杀进程或写成功记录。

### R3-F3｜没有执行恢复也会记录并输出“previous build restored”

**级别：高。对应独立负例 N3。**

`scripts/host/deploy-hephi.sh:248-257` 只有在 `current` 非空且目录存在时才尝试恢复；但无论是否进入该分支，后面都会写 `failed-restored-previous` 并输出 `previous build restored`。

实测在无 current 指针、显式提供 `--previous <A>` 的 rollback 中注入目标健康失败：

- 没有执行任何恢复；
- 指针仍停留在失败目标 B；
- 记录却为 `result=failed-restored-previous`；
- 输出却声称 `previous build restored and host kept paused`；
- 记录中的 `previous` 实际为空字符串。

此外，rollback 失败恢复使用 `current`，没有使用调用者显式提供且已校验的 `--previous`，与 R3.3 对 previous 的定义不一致。

**必须修正**：区分 `failed-no-previous`、`failed-restored-previous`、`failed-twice`；只有指针恢复、重启和全量健康检查都成功后，才能记录或输出“已恢复”。rollback 的恢复目标语义必须明确并统一使用显式 previous 或可靠解析的 current。

### R3-F4｜恢复指针自身失败会绕过统一双失败路径

**级别：高。对应独立负例 N4。**

普通部署的恢复调用 `scripts/host/deploy-hephi.sh:299` 和 rollback 的恢复调用 `250` 都没有错误捕获。脚本启用 `set -e`，所以恢复时的 symlink rename 一旦失败，会直接退出，无法执行后续记录和健康检查。

独立负例在目标 B 切换后注入健康失败，再仅对恢复阶段的 `renameSync` 注入 exit 42：

- 脚本以 42 直接退出；
- 没有生成任何部署记录；
- 指针仍指向失败目标 B；
- 没有进入 `failed-twice` 路径。

这直接违反 R3.1／R3.4 的“集中、不可绕过错误路径”和“保留现场、两次错误、宿主状态与日志”。

**必须修正**：所有恢复步骤都必须显式捕获失败，包括指针切换、重启、状态读取和健康检查；恢复指针失败也要写双失败记录并保留目标／previous／当前指针和真实错误。

### R3-F5｜暂停状态与双失败健康证据不可信

**级别：高。对应独立负例 N5，并有静态代码佐证。**

`scripts/host/deploy-hephi.sh:197-205` 的 `record()` 无条件写 `paused:true`，不会重新读取宿主状态。

独立负例在切换后让假宿主实际返回 `paused=false`、健康保持 ready：

- 部署 exit 0；
- 记录仍写 `paused:true`；
- 输出仍声称 `host remains paused`。

这不是说脚本主动解除暂停，而是说明**脚本没有证明暂停仍然存在，记录可能与实际状态相反**。

同时，`252` 和 `304` 在双失败时写 `health:"not-checked"`，没有保存两次实际健康响应或最后一次可读错误；这与脚本注释及清单要求的“双份健康证据”不符。

**必须修正**：结束时重新读取并保存真实 paused／load／health；不可读取时写 `unverified` 并非零或按失败处理，不能伪造 `true`。双失败记录至少保留目标阶段和恢复阶段各自的健康结果、错误、指针与时间。

### R3-F6｜current release 校验结果被显式忽略

**级别：高；静态确认，未单独做动态负例。**

`scripts/host/deploy-hephi.sh:243`：

```sh
[ -n "$current" ] && release_validate "$releases/$current" || true
```

无论 current release 校验是否失败，该复合命令都会继续。后续 `249-250` 只检查 current 的 `lib` 目录存在，就可能把它作为恢复目标。这意味着未通过 meta／SHA／入口哈希校验的构建也可能被恢复。

即使设计允许“current 损坏仍继续尝试 rollback target”，也不能随后把未通过校验的 current 当作可靠恢复目标。必须将“继续 rollback”和“允许恢复 current”拆成不同判断。

## 4. 原 44 条断言为何没有发现这些问题

1. **首次发布夹具没有旧普通 `lib` 目录**，因此没有覆盖实际迁移。
2. **rollback 只测了显式 target**，没有缺参负例。
3. **所有恢复 rename 都默认成功**，没有注入文件系统失败。
4. **paused 断言只查日志或输出字符串**，没有让真实假宿主状态与日志发生冲突。
5. **双失败只匹配 `both failed|kept paused`**，没有核对两份健康证据和实际宿主状态。
6. `R3-T09` 在目标与恢复阶段都保持 `github=starting`，只断言非零和指针回到 A；它没有证明“目标健康失败后，恢复 A 且恢复健康”的正向恢复路径。T08 只覆盖进程启动失败后的健康恢复。
7. `R3-T17` 对失败记录只检查少数字段存在，没有验证 paused、health、previous 的真实性。

因此，“44 assertions PASS”应保留为已测场景事实，但不能继续作为 R3 完成或允许真实验收的充分条件。

## 5. R1／R2 复核结果

### R1：代码层通过

静态实现符合既定口径：

- v2 对对象键递归排序，数组保持顺序；
- v1／无版本合同沿用历史原始 JSON 字节哈希路径；
- 未知版本不会静默按 v2 解释；
- 配置与构建 commit 解析保持懒加载边界。

完整测试中 `activation.test.ts` 30 个用例通过。该结论只覆盖代码和夹具，不替代历史生产合同加载或 P5 真实验收。

### R2：代码层及真实构建路径通过

在独立无硬链接克隆和 `git archive` 源码归档中实测：

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 干净 Git 提交，无环境变量 | 成功 | exit 0 |
| 未跟踪 dirty 探针，同时提供其他完整 SHA | 拒绝，不能覆盖 Git HEAD | exit 1，`refusing to build from a dirty working tree` |
| 无 Git，无 `HEPHI_BUILD_COMMIT` | 拒绝 | exit 1，明确要求完整 40 位 SHA |
| 无 Git，提供审查提交完整 SHA | 成功并嵌入该 SHA | exit 0，`describePlugin().commit = 17d3827d3a73d3afb7a3b8de130d1615bd351769` |

R2 的独立构建缺口已在本轮关闭；这不等于 P2 的宿主侧版本回读已完成。

## 6. 重新送审的最低门槛

1. 修复 R3-F1 至 R3-F6，并把 N1–N5 纳入仓库自动化；这些用例在旧提交应失败，在修复提交应通过。
2. 增加“目标健康失败 → previous 恢复 → 全量健康 ready”的正向恢复用例，不能只测双失败。
3. 对 rollback 的 target／previous 语义做参数级负例，缺参、空值、非法 SHA 均无副作用。
4. 对恢复 rename、状态读取、健康读取分别注入失败，证明所有路径都会留下真实记录并保持安全状态。
5. 成功、恢复成功、无 previous、双失败记录分别校验真实 paused、health、load、pointer、previous 和错误，不允许硬编码安全结论。
6. 重新执行 Node `22.19.0`／pnpm `11.7.0` 下完整 `pnpm check`、扩展后的假宿主套件和本报告负例。
7. 只有上述代码审查通过后，才进入 R3.7 真实宿主验收。

## 7. 仍未验证，不得记 done

本轮没有执行也不宣称以下事项：

- R3.7 真实宿主 A→B→A 切换；
- 实载插件 commit 回读；
- 真实健康故障注入与自动回滚；
- 真实 drain 字段语义；
- 暂停期受控 Issue smoke、恢复后完整 health／load；
- B5／PILOT／FORMAL 任一门槛；
- 人类负责人最终签收。

**最终意见：R1／R2 代码层可接受；R3 必须返修。当前 PR #20 不批准合并。**
