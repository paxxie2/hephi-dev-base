# 自检报告（2026-11-07）

范围：本仓库相对 `718087c` 的全部新增/修改（39 个源/测试/脚本/文档文件，约 +1.8k 行），对照资料包
`implementation-checklist.md`、`validation-matrix.md` 与 `task-tree.yaml`。

方法：静态审阅、`pnpm check`（typecheck + 176 tests + 构建）、`test:unit`/`test:integration` 分层运行、
脚本正反例实跑、与验收矩阵逐条对照。所有结论附可复核命令。

## 1. 代码检查

- 结构：新增 `src/version.ts`、`src/control/decision-log.ts`；修改 `activation.ts`、`worker-mount.ts`、
  `evidence-verifier.ts`、`check-runner.ts`、`check-store.ts`、`index.ts`、`tsdown.config.ts`；
  13 个 planned 命令脚本 + 7 个 eval 脚本 + 文档。无 `TODO/FIXME`，仓库未配置 lint（仅 tsc + tests）。
- 静态检查：全部 `.mjs` `node --check` 通过；全部 `.sh` `sh -n` 通过。

### 1.1 本次自检发现并已修复的缺陷

| # | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| S1 | shadow 模式下合同在挂载后不可读/被改写时，ready 被拒绝 | 违反 P4“shadow 一律放行、只观察”的语义 | `ready-gate.ts` 新增 `allowUnavailable`，`worker-mount.ts` 在 shadow 传入；新增测试覆盖 |
| S2 | `eval/check-data-package.mjs` 遇到符号链接自环时 `ELOOP` 未捕获并崩溃 | 数据包预检在异常目录上不可控 | 改用 `lstatSync`，符号链接记为 `symlink` finding，不再递归；复测自环目录 EXIT=1 |
| S3 | `eval/export-baseline.mjs` 数据库路径不存在时抛栈 | 错误不可读、退出码不可预期 | 捕获并明确报错退出 2；复测 EXIT=2 |

### 1.2 仍存在的限制（未修复，已登记）

| # | 限制 | 说明 |
| --- | --- | --- |
| L1 | 决策日志只做进程内串行 | 跨进程并发追加时 `seq` 可能重复（未加文件锁）；文档已标注 |
| L2 | 决策日志写失败仅写 stderr | 计划要求的“工具结果/独立告警通道”依赖 G1 新增项，尚未确认可用 |
| L3 | P2 legacy 合同例外 | 无 `plugin` 字段的旧合同不因构建不同被拒绝（其检查记录仍须为当前构建）；文档已标注，需人工确认口径 |
| L4 | 部署无不可变构建与自动回滚 | P8 只实现“构建→重启→回读→恢复”，回滚/竞态未实现 |
| L5 | 实载插件 commit 无回读入口 | 宿主无版本查询 API，`describePlugin` 无调用入口 |
| L6 | `rebuild-isolated.sh` 仅 macOS | 使用 BSD `sed -i ''` |
| L7 | eval/scripts 无自动化测试 | 仅人工正反例证据；未纳入任何 CI（按用户决定也不使用 Actions） |
| L8 | P4 super-agent 表面未改 | Worker 工具白名单/Skill 挂载面在本仓库之外，三组真实对照未做 |

## 2. 实施清单对照（21 节点）

| 节点 | 实施 | 验收 | 说明 |
| --- | --- | --- | --- |
| G1 宿主能力确认 | 探针脚本（状态回读） | 未完成 | 11 项 + 3 项需真实 Worker/牺牲 Session；版本回读判“不具备” |
| G2 代码基线定版 | 完成 | 完成（Agent 代办） | PR #7 合并、`hephi-baseline-1` 指 `3f276a5`、八项逐项审查；**缺人类独立审查签名** |
| P1 持续集成 | 不实施（用户决定） | 不适用 | workflow 已删除 |
| P2 版本可追溯 | 完成 | 部分 | 注入/合同/记录/ready 拒绝已实现并测试；宿主版本必填未做 |
| P3 决策日志 | 完成 | 部分 | write/check/ready 记录已实现；跨进程与真实告警通道未验证 |
| P4 影子模式 | hephi 侧完成 | 部分 | 冻结合同/放行/观察已实现并测试；super-agent 表面与三组对照缺 |
| P5 版本化 | activation 完成 | 部分 | activation v1 + 严格解析；活跃工单禁止升级未实现 |
| P6 测试分层 | 完成 | 部分 | 分层真实（unit 无 git 调用）；性能门槛未定义 |
| P7 专用测试宿主 | 脚手架脚本 | 未完成 | 无干净机器/独立操作者 |
| P8 部署与回滚 | 脚本 + 一次真实部署 | 部分 | 真实重启链路已证；回滚/竞态/实载回读缺 |
| P9 实验仓库与凭据 | 未实施 | 未完成 | 仅只读权限检查 |
| P10 Dubbo 构建环境 | 未实施 | 未完成 | 无 Dubbo 检查配置/三候选任务 |
| P11 原生入口 | 验证完成（smoke） | 部分 | Issue→Ticket→Worker→PR 真实；hephi 激活型被基线缺陷阻塞 |
| P12 人员与职责 | 校验脚本 | 未完成 | 无真人数据与 κ |
| P13 预算 | 预检脚本 | 未完成 | 无真实账单/批准 |
| P14 数据合规 | 预检脚本 | 未完成 | 无真实数据包/负责人确认 |
| P15 历史基线 | 导出/校验 + 首次归档 | 部分 | 60 条唯一 Ticket（目标 ≥100 未达）；trigger 关联表未导出 |
| P16 一致性 | 完成（除 Skill） | 部分 | Skill 修改待专项批准 |
| GATE-B5-SMOKE / PILOT / FORMAL | 未开始 | 未完成 | 硬依赖未全部 done |

## 3. 测试用例检查

- 全量：17 个文件 / **176 tests**，全部通过；相对基线 `a212d69`（155）新增 21 个用例。
- 分层：`test:unit` 7 文件 / 41 tests（实测无 git 调用）；`test:integration` 10 文件 / 135 tests（依赖真实 git）。
- 弱断言：仅 4 处既有用例使用 `toBeTruthy`（stage-control/worker-mount 既有场景），本次新增用例未引入弱断言。
- 覆盖缺口：eval 脚本 7 个、13 个 planned 命令脚本均无自动化测试；P2 构建注入、P3 跨进程、P4 三组对照、
  P5 活跃工单升级、P8 回滚/竞态、P9/P10/P12/P13 的真实场景未覆盖（见限制清单）。

## 4. 验收矩阵对照（62 场景）

| 节点 | 已覆盖 | 部分 | 未覆盖 | 不适用 |
| --- | --- | --- | --- | --- |
| G1 | 0 | 1 | 5 | 0 |
| G2 | 5 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 | 3 |
| P2 | 2 | 1 | 1 | 0 |
| P3 | 1 | 2 | 0 | 0 |
| P4 | 2 | 1 | 2 | 0 |
| P5 | 3 | 0 | 1 | 0 |
| P6 | 1 | 0 | 1 | 0 |
| P7 | 0 | 0 | 2 | 0 |
| P8 | 0 | 2 | 2 | 0 |
| P9 | 0 | 1 | 2 | 0 |
| P10 | 0 | 0 | 3 | 0 |
| P11 | 1 | 0 | 1 | 0 |
| P12 | 0 | 1 | 2 | 0 |
| P13 | 0 | 1 | 1 | 0 |
| P14 | 0 | 1 | 2 | 0 |
| P15 | 1 | 3 | 0 | 0 |
| P16 | 1 | 0 | 0 | 0 |
| GATE-B5 | 0 | 0 | 3 | 0 |
| **合计** | **17** | **14** | **28** | **3** |

已覆盖集中在 G2（5）与 P5（3）；未覆盖集中在 G1 真机探针、P7/P9/P10/P12/P13 外部资源项与三个 B5 门槛。

## 4.1 补遗（同日后续修复）

| # | 补充 | 证据 |
| --- | --- | --- |
| S4 | `eval/check-baseline.mjs` 对非法 JSON 会抛栈（关系表被篡改时） | 改为 `parseJson` 收集问题并继续；新增负例测试 |
| S5 | P15 关系表（Trigger/Disposition/Thread/Trigger↔Thread）未导出 | `eval/export-baseline.mjs` 增加关系表导出与 summary 计数；`check-baseline` 校验计数、source 内唯一性与引用；第二次真实归档 r2 通过 |
| S6 | eval/scripts 无自动化测试（原 L7） | 新增 `hephi/tests/eval/cli.test.ts`（4 用例，覆盖 kappa、基线与关系表、roles/budget/data-package、shadow-parity/dubbo 运行器），纳入 integration 层 |
| S7 | P6 的测试分层文档实际未落盘（`a96dc1b` 只改了 `package.json`，README 未被修改；此前汇报有误） | 根 `README.md` 新增「测试分层（P6）」小节，记录 unit/integration 命令、覆盖与实测耗时（0.45s / 34s），并更新总数 180 |
| S8 | P8 无不可变构建/自动回滚（原 L4） | 部署脚本增加构建快照、`releases/<sha>/lib` 与 `--rollback`；在 B 实例完成“部署→回滚→再部署”三轮实测，入口 sha256 前后可对照 |
| S9 | P8 竞态场景未验证（原缺口） | 暂停期间创建 Issue 实测：Trigger 持久化、无 Ticket/Worker；恢复后调度层只处理一次。**发现 worker 重复创建两个 PR**（外部产物层未满足“只处理一次”），记录见 `docs/p8-race-record.md` |
| S10 | P5“有进行中工单时禁止升级”未实现 | 部署脚本增加进行中 Ticket 检查与 `--allow-open-tickets` 显式跳过；暂停状态下实测拒绝（3 个进行中 Ticket）与放行 |
| S11 | hephi 激活交付未做过真实 smoke（P11/B5 入口） | 合并基线修复 PR #29、使检查自包含后完成两轮：第一轮因 prepare/Worker 构建不一致被 `ready.plugin-build` 拒绝（fail-closed）；部署重启后第二轮完整通过（合同→hephi_check pass→ready.pass→PR #42）。记录见 `docs/p11-hephi-smoke-record.md` |
| — | 测试总数 | 176 → **180**（unit 41 / integration 139）；`pnpm check` 全绿 |

## 5. 结论

- 代码：176 tests 全绿、构建通过；自检发现 3 个缺陷（1 个行为语义、2 个健壮性）均已修复并复测。
- 实施：资料包 21 个节点中，6 个已完成实施（G2、P2、P3、P4、P5、P6 的代码/文档部分），
  P1 按用户决定不实施，其余受外部资源或仓库外改动阻塞；验收层面只有 G2 由 Agent 代办完成（缺人类签名）。
- 建议下一步：优先补 P8 回滚/实载回读与 P15 trigger 关联表；G1 真机探针与 P9–P13 需外部资源；
  P4 三组对照需要 super-agent 仓库与宿主导出。
