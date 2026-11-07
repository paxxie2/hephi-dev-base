# HEPHI-PREREQ-R2 独立复核报告

复核时间：2026-11-07  
复核对象：`paxxie2/super-agent-hephi-review` 的远端 `main@5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`  
复核方式：隔离克隆、静态代码与文档抽查、完整测试复跑、针对性负例、运行产物副本校验。未操作原始本地仓库，未重启宿主，未创建或修改 Issue／PR。

## 1. 总结论

**提交与测试回执的核心部分可以确认，但不能据此判定 G1、G2、P1–P16 或 B5 已全部实施并通过验收。**

当前不应开放 B5 有度量试跑或正式实验。至少应先修正本报告的 P8、P5、P2 阻断项，并保留 P3／P4、真实宿主、人员、预算、数据和其他外部资源项为未完成或部分完成。

本次是独立静态复核与本地测试，不是人类 G2 审查，也不是生产环境验收。

## 2. 已独立确认

| 项目 | 实测结果 |
| --- | --- |
| 远端主干 | 克隆后 `HEAD = origin/main = 5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1` |
| 基线标签 | annotated tag `hephi-baseline-1` 解析到 `3f276a533bceaa63f3e43ff8d0d1e75af9dac8c8` |
| 合并历史 | `main` 历史中可见 PR #7–#19 的合并提交 |
| 完整检查 | `pnpm install --frozen-lockfile && pnpm check` 成功，18 个测试文件／180 tests 全过，构建成功 |
| 脚本语法 | 仓库内全部 `.mjs` 的 `node --check`、全部 `.sh` 的 `sh -n` 通过 |
| 差异格式 | 指定范围 `git diff --check` 通过 |
| 构建身份 | 干净构建的 `describePlugin().commit` 为完整 `5efd7084…` |
| P15 归档副本 | 现有校验器返回 `ok: true`；61 Ticket／61 uniqueIds、85 Trigger、85 Disposition、107 Thread、85 关联、33 个 PR 关联 |
| 审查副本完整性 | 冻结范围验收脚本四项 PASS；审查仓库被修改文件为 0 |

测试环境为 Node `v24.22.1`、pnpm `11.7.0`，不是方案指定的 Node `22.19.0`；因此还需在指定 Node 版本复跑一次，才能关闭版本环境要求。

## 3. 阻断问题

### F1｜P8 的不可变部署、自动回滚和健康门禁尚未满足验收定义

证据位置：`scripts/host/deploy-hephi.sh:75-81、96-103、125-147、150-171`。

1. `publish_release()` 对已有的 `releases/$sha/lib` 执行 `rm -rf` 后重新复制，并重写 `meta.json`。同 SHA 的发布目录可被覆盖，不是不可变目录。
2. 普通部署在 `restart_instance` 失败时只输出错误并退出，没有恢复 `snapshot_live()` 保存的上一构建。只有显式 `--rollback` 路径包含失败恢复逻辑。
3. 重启等待只检查 `health.runtime.state == ready`，没有等待全部必要健康项。`deploy-20261107T054720.json` 已记录脚本完成时 `github.state = starting`。
4. 脚本结尾明确承认无法回读 `describePlugin()` 的实载 commit；运行时 ready 不能替代实载版本验证。
5. 发布是把当前 `$hephi/lib` 复制到 `$releases/$sha/lib`，随后仍重启原 `$hephi/lib`，不是从不可变目标版本切换；也不支持按指定 target／previous 两个已知构建顺序切换。
6. `--allow-open-tickets` 可绕过“有进行中赫菲工单时禁止升级”的固定策略。若确需逃生口，必须单独批准并修改方案，而不能默认保留。

因此 P8 目前只能记为“真实重启与成功路径回滚有部分证据”，不能记为验收通过。对应 V-P8-01、V-P8-03、V-P8-04 仍未闭环。

### F2｜P5 合同哈希没有执行规范化序列化

证据位置：`hephi/src/control/activation.ts:171-176`。

`contractHash()` 直接对输入对象 `JSON.stringify`，没有递归排序对象键。独立负例对 `{alpha:1,beta:2}` 与 `{beta:2,alpha:1}` 得到不同 SHA256，实测 `equal=false`。

这不满足方案“不得因语言或键顺序差异误算”和 V-P5-03。现有 activation 测试覆盖版本、未知字段和篡改，但没有覆盖语义相同、键顺序不同的对象。

需要定义并实现递归规范化规则，明确数组顺序是否保留、数字与可选字段如何处理，并增加跨键序一致、语义变化必失败的测试。历史合同的兼容或迁移策略也需同步说明。

### F3｜P2 的 dirty 构建负例与验收矩阵相反

证据位置：`hephi/tsdown.config.ts:8-17`、`hephi/docs/versioning.md:32`。

在独立脏树副本中新增未跟踪文件后，`pnpm build` 成功，`describePlugin().commit` 返回 `5efd7084…-dirty`。但 V-P2-02 明确要求 dirty 构建失败。

主清单虽允许“dirty 标记和源码树摘要”作为实施层备选，但当前只有 `-dirty` 后缀，没有源码树摘要；发布构建也只接受干净可复核提交。因此无论按验收矩阵还是主清单，当前都不能关闭该项。

此外，自检报告已承认宿主版本必填未做，P2 的真实部署双构建、实载 commit 和宿主版本回读仍未完成。

## 4. 仍未完成的关键事项

### P3 决策日志

- `hephi/src/control/decision-log.ts:28-29` 只有进程内 Promise 队列，没有跨进程文件锁；不能证明多进程 seq 唯一。
- `decision-log.ts:72-78` 写失败只写 stderr，没有方案要求的真实工具结果或批准的独立告警通道。
- 崩溃恢复和重复 callId 的专门负例未覆盖。P3 应保持部分完成。

### P4 shadow/off 干净对照

- hephi 侧 shadow 不注册 `hephi_check`、不注入启动提示是已实现行为，但这不等于模型可见表面与无插件一致。
- super-agent 固定工具白名单、全局工具和 Skill 挂载面未按三组完成隔离；无插件／无标签／shadow 的主 Worker、子 Agent、恢复 Session 真实对照未做。
- P4 未通过前，GATE-B5-PILOT 不得放行。

### G2、P1 与其他外部依赖

- `docs/g2-baseline-review.md:3-5` 明确说明审查由同一 Agent 代办，不是非原实现者的人类独立审查。G2 不能写成独立验收完成。
- P1 按用户决定不使用 GitHub Actions。由于正式门槛原依赖 P1，必须正式修订门槛或保持阻塞，不能仅写“不适用”后视为满足。
- P6 性能门槛及三次对比未闭环；P7 干净机器独立重建未完成；P9 最小权限与吊销未闭环；P10 三候选及 base 负例未完成；P12–P14 缺真实人员、预算和数据批准。
- P15 当前归档可读且内部校验通过，但只有 61 个唯一 Ticket，未达到计划目标 100；窗口和只读凭据仍待用户确认。目标不足可以如实报告，但不能改写为全量验收通过。

## 5. 文档一致性问题

1. `docs/implementation-index.md:9` 仍写“本轮最终 `3141a37`”，实际是 `5efd708`；第 26 行只列 PR #7–#18，遗漏 #19。
2. `docs/self-check-2026-11-07.md` 前文仍列已后续修复的 L4／L6／L7，结论仍写 176 tests；补遗又写 180 tests。限制清单、矩阵和结论没有同步到同一时点。
3. `docs/p11-hephi-smoke-record.md:42` 已记录 PR #42 合并，第 55 行却仍写“hephi activated 的 PR 合并未做”。
4. `docs/p8-race-record.md` 前文说明重复 PR 无法归因于本 Worker，结论却仍写“外部产物层未通过”。应改为“存在来源未确认的外部重复产物，本 Worker 的重复执行未证实”，避免把未知来源记成确定缺陷。

这些问题不妨碍提交存在，但会误导下一位执行者，应随下一轮修复一起更新。

## 6. 验证边界

- 未直接检查原始本地目录的全部分支、工作树和 ahead 数，只确认了隔离克隆与远端 main／tag。
- `site-pnl-diagnosis` 的 main 和 PR #42 未能独立读取：Git 访问失败，GitHub CLI 未认证，公开页面返回 404。本报告不否认回执，只标为未验证。
- 未实时访问 A／B 宿主，未确认当前 `paused=false、running=0、runtime=ready`。
- 未重新运行真实部署、真实 Issue→Ticket→Worker→PR smoke、Dubbo 离线构建或生产数据导出；只复核了文档和部分产物副本。
- 本次不是 31 个变更文件逐行穷尽审查；结论基于关键路径抽查、完整测试和针对性负例。

## 7. 建议修复顺序

1. **先修 P8**：同 SHA 发布拒绝覆盖；从不可变 release 原子切换；普通部署失败自动恢复上一版本；等待必要健康项全部 ready；补 target／previous 双版本与故障注入测试；实载 commit 无入口则保持 P2/P8 未通过。
2. **修 P5 与 P2**：规范化哈希及兼容测试；按冻结口径拒绝 dirty 构建，或先正式修订验收矩阵并补源码树摘要。
3. **同步文档**：更新 implementation-index、self-check、P11、P8 race 的状态与矛盾表述。
4. **保留未完成门槛**：P3、P4、G1、G2 独立审查、P6–P15 外部依赖未闭环前，不提升 B5 状态。
5. **复验**：在 Node 22.19.0 上跑完整检查，再执行新增负例和真实宿主验收。
