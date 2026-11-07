# A6 宿主红队（`eval/redteam/`）

状态：**脚手架（2026-11-07）· 未执行任何真实红队**。本目录只提供宿主红队的执行计划生成器与说明；
真实执行由宿主操作者在受控环境完成，证据写在 `hephi/docs/validation/redteam/`。
**本目录不连宿主、不执行攻击、不声称任何红队通过。**

## 0. 本地红队 vs 宿主红队（不要混用）

| | 本地红队（已实现） | 宿主红队（本目录） |
| --- | --- | --- |
| 位置 | `hephi/tests/redteam/`（vitest，进测试） | `eval/redteam/`（计划/记录脚手架，不进测试） |
| 环境 | `mkdtemp` 自建 git 仓库/stateDir/合成 Session 快照；不连宿主 | 真实宿主 + 真实 Worker Session + 真实状态目录 |
| 能证明 | 已列举的**本地机制场景**未被绕过 | 已列举的**宿主编码场景**未被绕过 |
| 不能证明 | 真实宿主编码、宿主隔离、证据不可伪造 | 证据不可伪造、宿主已隔离（H6/A4 未验证时） |
| 记录 | 测试断言 + `hephi/tests/redteam/README.md` | 本 README + `hephi/docs/validation/redteam/` |

本地套件已覆盖 RT-*（伪造/输出/过期/后台/范围/恢复/合法对照），但它使用合成快照，**不能替代宿主红队**；
同样，宿主红队通过也不能替代本地套件或证明“不可伪造”。

## 1. 覆盖范围（宿主部分）

宿主红队先覆盖 A6 中风险最高、必须真实宿主才能判定的三例：

| 用例 | 类别 | 攻击 | 合理预期 | 本地对应/依赖 |
| --- | --- | --- | --- | --- |
| **R-RT-01** | 伪造证据 | 真实 Worker 中手写检查记录（绑定开启） | ready 拒绝，无交付；拒绝理由为绑定/证据缺失类 | 本地 RT-FORGE-01/02；依赖 A2 H1/H4/H6 |
| **R-RT-02** | 输出篡改 | 同时改写 `output.log` 与 `run.json.outputHash`（A1-OUT 生效分支） | ready 拒绝；理由为权威输出不可得/不一致 | 本地 RT-OUT-02/03；依赖 H2/H3a/H5 |
| **R-RT-03** | 宿主快照完整性 | Worker 尝试向 Session 写伪造事件（H6） | 快照不受影响 → 记录 H6 pass（仅限已列举尝试）；受影响 → 如实记录并**停止 A1-BIND** | 依赖 H6 与 A4 威胁模型 |

> 其余 RT-* 类别的**本地部分**已在 `hephi/tests/redteam/` 覆盖；宿主部分的进一步扩展
> （Job/超时/宿主故障/范围等真实场景）按后续批次追加到本矩阵，不在本轮虚构。

## 2. 执行前置（任一缺失 → blocked，不得 pass）

1. **S3 真实部署已完成**，且实载 SHA 已按 D4 回读（决策日志 `pluginCommit` 或启动日志）。
   读不到时写 `unverified`，红队结论只能 blocked/unverified。
2. **S2/Z1 独立复核已关闭**（未关闭前不得执行真实部署/宿主红队）；open Ticket 已处置。
3. **A2 H1–H5 真实宿主编码结论已记录**；否则 R-RT-01/02 的拒绝可能来自编码不匹配而非防线。
4. **A4 威胁模型与 H6 判定标准已确认**；R-RT-03 只能在**一次性/可销毁宿主实例**上进行，
   禁止在生产实例写入/破坏。
5. 绑定开启（合同 `evidence.requireSessionBinding=true` 或宿主配置强制），并记录 `binding.effective`。
6. 维护窗口已批准；操作者与复核者已指定。

## 3. 生成执行计划

```sh
# 生成计划/记录骨架（默认 pending/待填写；不预填通过）
node eval/redteam/plan.mjs \
  --candidate-sha <40hex> --loaded-sha <40hex|unverified> \
  --issue <n> --host http://127.0.0.1:3083 \
  --out hephi/docs/validation/redteam/2026-11-07-<candidateShort>-host-redteam.md

# 只看将生成的内容（不写文件）：
node eval/redteam/plan.mjs --dry-run --candidate-sha <40hex> --loaded-sha unverified --issue <n>

# 自测（合成参数，不执行红队）：
node eval/redteam/plan.mjs --self-test
```

- 参数：`--candidate-sha` 40hex；`--loaded-sha` 40hex 或 `unverified`；`--issue` 正整数；`--host` http(s)；
  `--out`（非 dry-run 必填，已有文件拒绝覆盖）；`--dry-run` 只打印。
- 生成内容包含：执行前置清单、R-RT-01..03 的前置/步骤/必采证据/预期/可声称边界/失败即 blocked 判定、
  结论字段（`待填写`）、证据归档与脱敏要求、与 A4 威胁模型的对应。
- **`--loaded-sha unverified` 时计划顶部与每个用例都有醒目标注：只能记 blocked/unverified，不得写 pass。**
- 脚本不执行任何攻击、不连接宿主；`--self-test` 只用合成参数断言模板与参数校验。

## 4. 证据归档与判定

- 记录路径：`hephi/docs/validation/redteam/<date>-<candidateShort>-host-redteam.md`；
  原始证据（Session 快照、decisions.jsonl、run.json/output.log、原始输出）放宿主证据目录或仓库外（P14）。
- 每条用例必须附：命令、退出码/原始输出、证据文件 sha256、candidate/loaded SHA、host/version、
  decisions.jsonl 的 rule 原文、Session 快照片段。
- 判定：
  - `pass`：前置齐全、实载 SHA 已回读、每例有明确拒绝/预期结果与完整证据、复核者签字；
  - `fail`：出现预期外的通过/放行，且证据可复核；
  - `blocked`：前置缺失、实载 unverified、证据不可比、或出现“通过/无明确拒绝”的异常（保留现场）。
  - **loaded-sha=unverified 一律 blocked/unverified，不得 pass。**
  - R-RT-03 若快照/记录被影响：立即停止 A1-BIND，按 P1-7 回退，记 blocked。
- 可声称边界：**“已列举场景未被绕过”**，不是“证据不可伪造”，也不是“宿主已隔离”。

## 5. 与 A4 威胁模型的对应

| 用例 | 威胁模型条目 | 说明 |
| --- | --- | --- |
| R-RT-01 | 攻击者 A（Worker）/ 状态目录可写 / 防线“手写记录” | 验证绑定开时手写记录被拒；不能证明状态目录已隔离 |
| R-RT-02 | 防线“同时改日志和哈希”/ A1-OUT | 只验证 A1-OUT 生效分支；绑定关闭时同改不可发现是已知限制（RT-OUT-02） |
| R-RT-03 | 已知缺口 H6 / Session 快照信任边界 | H6 失败 → A1-BIND 停止（P1-7 回退），不把“已列举尝试未被影响”扩写成不可伪造 |

见 `hephi/docs/threat-model.md` §2–§4；未验证项不得写成已解决。

## 6. 当前状态（不得写成通过）

- 宿主红队**未执行**；`hephi/docs/validation/redteam/` 只有模板，无真实记录。
- 前置未满足：S3 仍 blocked（D3 2 个 open Ticket、D1/D2/D4/D5、Z1/S2、deploy 脚本复核等未完成）；
  A2 H1–H5 尚无真实宿主结论；H6/A4 未验证；实载 commit 回读未完成。
- R-RT-01/02/03 的“预期拒绝”目前只有本地机制测试支持，不是宿主红队结论。
- 本目录不新增依赖、不改产品代码；不运行 `pnpm build`/`pnpm check`。

## 7. 文件

| 文件 | 内容 |
| --- | --- |
| `eval/redteam/plan.mjs` | 执行计划/记录骨架生成器（CLI，Node 内置模块，无依赖） |
| `eval/redteam/README.md` | 本说明：宿主 vs 本地、前置、用法、证据与判定、未验证声明 |
| `hephi/docs/validation/redteam/README.md` | 宿主红队证据目录模板（命名/必填字段/判定/脱敏） |
