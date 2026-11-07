# R3 返修与 R3.7 交接独立复核报告

日期：2026-11-07  
审查对象：`main@8fd199da1d2437ccc9da90a0cfcca64d1646549d`  
交接文件：`HANDOFF-R3.7-2026-11-07.md`  
方式：独立工作树、完整测试复跑、隔离假宿主追加正负例、交接证据静态核验。未修改产品源码，未访问或操作真实宿主。

## 1. 总结论

1. **PR #20／#21／#22 的合并链和最终 SHA 属实**，但合并是仓库状态，不等于 R3 或 P8 验收通过。
2. **原 R3-F1–F6 的直接缺陷均有有效修复**；最终 main 的完整检查和 69 条假宿主断言独立复跑通过。本轮还补验了 F6 动态负例、非法 previous、普通部署健康失败后的正向恢复，三项均符合预期。
3. **R3 仍不宜进入真实部署验收**：追加测试复现了 3 个原 69 断言未覆盖的边缘失败语义问题，涉及双失败时实际未暂停、恢复证据串用旧状态、旧目录恢复失败仍宣称已恢复。
4. **R3.7 判 blocked 正确**：真实 API 缺 5 个排空字段，脚本按清单 fail-closed；另有 2 个 open Ticket 和未批准的 hostVersion 语义。所附证据支持“未构建、未切换、未重启，随后恢复派发”。
5. **实载 `lib/` 的磁盘恢复有哈希证据，但实载 commit 仍未证明**。在宿主未暂停时移动并复制目录不是可复用的安全回滚流程，应作为独立运维风险整改。
6. 交接和仓库文档有若干事实需要更正，最重要的是：**最终旧提交套件的 N4 原始日志是 `exit 42`，不是交接所述 `exit 0`**；真实 `lib/` 仍是普通目录，不是部分文档所称 symlink；implementation index 的“当前 main”也停留在 PR #20。

因此，当前建议保持：**R1／R2 代码层通过；R3 假宿主主套通过但需追加返修；R3.7／P8 继续 blocked / unverified。**

## 2. 本轮独立复跑结果

环境：Node `v22.19.0`、pnpm `11.7.0`。

| 项目 | 本轮结果 |
| --- | --- |
| 最终提交 | `8fd199da1d2437ccc9da90a0cfcca64d1646549d`，与 `origin/main` 一致 |
| `cd hephi && pnpm check` | exit 0 |
| `node scripts/host/test-deploy-hephi.mjs` | exit 0，`PASS: 69 assertions` |
| `git diff --check 5efd708..HEAD` | exit 0 |
| 差异范围 | 16 个文件，与交接清单一致 |
| 9 个保护文件 | 相对 `5efd708` 无差异 |
| 基线标签 | `hephi-baseline-1^{}` = `3f276a533bceaa63f3e43ff8d0d1e75af9dac8c8`，未移动 |
| 审查树 | 复跑后干净，HEAD 未变 |
| 冻结计划机械验收 | 总体 PASS；但只覆盖上述既定命令，不覆盖追加 X1–X3 |

证据：

- `evidence/r37-independent/delivery-verification.log`
- `evidence/r37-independent/additional-tests.log`
- `evidence/r37-independent/additional-tests.json`
- 追加测试源码：`r37-additional-tests.mjs`

## 3. 原 F1–F6 与补充门槛复核

| 项 | 本轮判断 | 依据／边界 |
| --- | --- | --- |
| F1 普通目录首迁 `EISDIR` | 原缺陷已修复 | N1／N1b 在 69 断言中通过；但旧目录恢复也失败时仍有 X3 |
| F2 rollback 隐式 HEAD | 已修复 | N2 通过；本轮 P2 另验非法 previous 在读取宿主和切换前拒绝、无记录 |
| F3 未恢复却记 restored | 已修复 | N3 通过；无有效恢复目标走 `failed-no-previous`，真恢复后才写 restored |
| F4 恢复 rename 裸退出 | 原缺陷已修复 | N4 通过并写 `failed-twice`；但双失败暂停和状态证据仍有 X1／X2 |
| F5 paused 硬编码 | 成功路径已修复 | N5 通过，真实 `paused=false` 会写 `failed-not-paused`；失败路径仍只记录、不保证暂停 |
| F6 坏 current 被恢复 | 本轮动态验证通过 | P1 篡改 current 入口后 rollback 目标失败，脚本未恢复坏 current，写 `failed-no-previous` |
| 普通部署健康失败后的正向恢复 | 本轮验证通过 | P3 目标 B 健康失败，A 恢复后全健康，记录 `restoreHealth=all-required-ready` |
| 最终 69 断言 | 通过 | 本轮最终 main 独立复跑，不只是引用交接结果 |
| 旧提交反向证据 | 19 FAIL 有原始日志支持 | 但最终日志的 N4 是 exit 42；交接对 N4 的描述需更正，见 §7 |

P1–P3 目前只在本轮外部追加测试中执行，建议纳入仓库自动化，避免文档继续标为 missing。

## 4. 新发现问题

### X1｜双失败时真实 `paused=false`，脚本仍输出“host kept paused”

**级别：高；动态复现。**

代码原因：

- `paused_now()` 只在部署或 rollback 的**成功路径**调用（`deploy-hephi.sh:304-310`、`364-370`）。
- 双失败路径在 `334-335`、`397-398` 直接调用 `fail_keep_paused`；该函数在 `252-255` 实际只打印消息并退出，既不重新暂停，也不检查暂停状态。
- `record()` 会如实记录 paused，但输出和 `error` 字段仍固定声称 kept paused。

本轮在目标和恢复均健康失败、宿主真实返回 `paused=false` 时观察到：

- 脚本非零退出；
- `failed-twice` 记录中的 `paused` 为 `false`；
- 输出仍为 `host kept paused with both errors recorded`。

这意味着宿主可能已能接新任务，违反脚本不变量 5 和清单 R3.1／R3.4。不能仅凭非零退出认定“保持暂停”。

**修复要求**：所有切换后的失败出口都回读并处理 paused；若为 false 或 unverified，应写明确的 `failed-not-paused`／人工接管告警，不得再声称 kept paused。若设计允许脚本调用暂停 API，应在授权范围内尝试重新暂停并回读确认。

### X2｜恢复阶段读不到状态时，`restoreFailure` 复用目标阶段旧状态

**级别：高；动态复现。**

`restart_instance()` 使用全局 `LAST_STATE`，但在每次重启尝试开始时没有清空（`196-216`）。若恢复阶段完全读不到状态，`FAIL_STATE="$LAST_STATE"` 会保留目标阶段最后一次响应。

本轮让目标 B 返回带 `target-only-evidence` 的健康错误，随后让恢复 A 的状态请求全部失败，结果为：

- `targetFailure` 含目标错误；
- `restoreFailure` 与 `targetFailure` 完全相等，也含 `target-only-evidence`；
- 最终 paused 为 `unverified`。

这不是两次独立健康证据，而是把旧目标状态误记成恢复失败证据。

**修复要求**：每次 restart 尝试重置本阶段状态；区分 `state-unreadable`、停止超时、健康超时和具体健康响应。没有读到恢复状态时写 `unverified` 或明确读取错误，禁止沿用上一阶段字符串。

### X3｜普通目录恢复 `mv` 也失败时，仍声称旧目录已恢复、现场已保留

**级别：高；动态复现。**

`set_pointer()` 在普通目录迁移第二步失败时执行（`137-141`）：

```sh
mv "$migration" "$hephi/lib" 2>/dev/null || echo "cannot restore ..." >&2
...
echo "pointer rename failed ...; old lib directory restored" >&2
return 1
```

无论恢复 `mv` 是否成功，都会输出 `old lib directory restored`。上层随后仍输出 `previous state preserved`，记录也只有泛化的 `failed-pointer`。

本轮同时注入 symlink rename 失败和旧目录恢复 `mv` 失败：

- `$hephi/lib` 最终不存在；
- 输出同时包含 `cannot restore plain lib directory` 和 `old lib directory restored`；
- 上层仍声称 `previous state preserved`；
- 记录未表达旧目录恢复失败。

**修复要求**：把旧目录恢复失败作为独立双失败结果，记录实际目录／指针、备份位置和两个错误；只有恢复 `mv` 成功并核对旧内容后，才能输出 restored／preserved。新增 N1c 覆盖该双重故障。

## 5. R3.7 blocked 判定

### 5.1 判定成立

交接所附真实状态文件显示：

- `state-before.json`、`state-paused.json` 和 `state-after-resume.json` 的 `load` 均只有 `running/queued/maxWorkers`。
- `deploy-attempt.txt` 明确列出缺失的 `startupReservations/effects/jobs/subagents/unknown`，部署 exit 1。
- 清单 R3.5 要求任一字段无法读取或语义未知即为 blocked/unverified，不得默认 0。因此脚本拒绝与既定方案一致，**不是应被绕过的“脚本过严”**。
- `preflight.txt` 独立记录 2 个 state=open 的 Ticket；即使 drain 解阻，下一道门禁也会拒绝。
- hostVersion 只有实验性标识，未见经批准的固定语义；不能写入正式 release metadata 冒充已定版。

代码顺序也支持无副作用结论：drain 和 open Ticket 检查在构建、指针切换和 restart 之前。原始副作用核对显示 host.pid、releases 数、logs 数、lib 类型和树哈希不变；恢复后 runtime 时间戳仍是原进程时点。

### 5.2 仍未执行

- 真实 A→B→A；
- 实载 commit 回读；
- 真实可恢复故障注入与自动回滚；
- 暂停期受控 Issue smoke 及恢复后完整验收。

所以 R3.7 是**已尝试、在门禁处 blocked**，不是“通过”，也不是“完整执行后失败”。P8 继续保持部分／unverified。

## 6. 实载 `lib/` 污染与恢复边界

证据支持以下有限结论：

- 验证构建曾改写实载目录中的磁盘 `lib/`；
- 最终 `live-lib-restore.txt` 与 `final-live-lib-restore.txt` 显示 live entry 与历史 release entry 一致，live／release／snapshot 树哈希有一致记录；
- 当时宿主 health、load、paused 有回读，仓库工作树干净。

但不能扩大为“运行中的插件已恢复到该 commit”：宿主没有实载版本回读，且进程未因这次复制而重启。磁盘一致不等于内存实载一致。

此外，恢复时宿主为 `paused=false`，采用“移动旧目录 + 从 release 复制”的非原子过程。健康回读不能排除复制窗口内的动态加载风险，不能把它当成标准回滚步骤。

**运维整改建议**：

1. 开发工作树与宿主 profile 的实载目录彻底分离，禁止在实载工作树运行 `pnpm check`／`build`。
2. 实载只指向经过校验的不可变 release；不要在普通实载目录中直接复制恢复。
3. 若必须再次恢复，先暂停、排空并停止宿主，完整校验后原子切换，再启动、全量健康检查并由操作者恢复派发。
4. 保留“实载 commit unverified”，直到宿主提供真实版本查询入口。

## 7. 文档与交接必须更正的事实

### 7.1 最终套件的旧 N4 是 exit 42，不是 exit 0

`HANDOFF-R3.7-2026-11-07.md` §5，以及 `docs/p8-deploy-record.md:91`、`docs/remediation-r3-validation.md` 多处和 `docs/self-check-2026-11-07.md:143`，把旧提交 N4 描述为 `exit 0` + `result:ok`。

但最终套件原始日志 `evidence/pr20-fix/old-commit-final-7f50c13-suite.log:102-110` 显示：

- `N4 recovery rename failure exits nonzero without raw 42 :: code=42`；
- 目标健康超时后发生注入的 pointer rename failure；
- 没有目标 B 的 `result:ok`，只有首次 setup A 的 ok 记录。

早期改前快照日志确实出现过 `code=0`，但那是修复 harness ready 时序前的结果，不能用来描述最终套件。正确写法应区分：**早期快照曾 exit 0；最终套件为 exit 42。19 FAIL 总数不受此更正影响。**

### 7.2 真实 `lib/` 是普通目录，不是 symlink

`docs/remediation-r3-validation.md:143` 和 `341` 称真实实例当前已是 symlink。R3.7 preflight、deploy side-effect check 和最终恢复记录均为 `plain-directory`。应更正，否则会误判首次迁移场景是否仍然存在。

### 7.3 implementation index 的当前 main 和 PR 状态已过期

`docs/implementation-index.md:9` 和 `28-29` 仍把 `bc3386c`／PR #20 写成当前 main；实际远端和本轮工作树均为 `8fd199d`，PR #21／#22 已合并。建议同步 PR #21、#22、当前 SHA 和 R3.7 blocked 时点。

同文件 `72` 的返修 diff 命令仍结束于 `0d58bc3`，会漏掉 `2409613` 的修复；应改为最终审查范围，例如 `5efd708..8fd199d`。

### 7.4 “未开始／未做”需标注历史时点

返修文档仍有“R3.7 未开始”“二次独立复核未做”“最终套件重跑进行中”等句子，同时后文已经记录尝试或补测。若保留历史，应明确“截至某提交／时间”，不要让它们以当前状态出现。

## 8. 再次进入真实验收前的最低条件

1. 修复 X1–X3，并将对应负例加入仓库；在当前 `8fd199d` 上应失败，在修复提交上应通过。
2. 将本轮 P1（F6）、P2（非法 previous）、P3（普通部署健康失败后健康恢复）纳入自动化。
3. 对所有切换后的成功、恢复成功、无 previous、双失败路径统一校验真实 paused；false／unverified 不得输出 kept paused。
4. 每次重启尝试独立保存状态与错误，注入恢复阶段状态不可读，证明不会复用 target 状态。
5. 注入旧目录恢复 `mv` 失败，证明不会输出 restored／preserved，且记录双失败和备份位置。
6. 更正 §7 的交接与文档事实，重新执行完整 `pnpm check`、扩展假宿主套件和独立复核。
7. 代码门槛关闭后，再处理外部解阻项：真实 drain 字段语义、正式 hostVersion、2 个 open Ticket；不得默认 0、编造版本或绕过 Ticket。

## 9. 仍未证明

- R3.7 真实切换和真实故障恢复；
- 实载插件 commit；
- 真实 drain 5 字段及正式 hostVersion；
- 真实普通目录迁移；
- B5／PILOT／FORMAL；
- 人类负责人最终签收。

**最终意见：确认合并事实和 R3.7 blocked 判定；原 F1–F6 的直接修复有效，但 X1–X3 需要新的返修。当前不得把 R3 或 P8 标为真实验收通过。**
