# R1／R2 修复验证记录（2026-11-07）

对应 `HEPHI-R2-remediation-checklist.md` R4.3 的交付要求（新建本文件）与 R5.3 验收矩阵：逐条登记实际命令、退出码、证据路径、复核者和局限。**本文件不替代独立验收**；R3（部署脚本/自动回滚/全量健康门禁）见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md)。

## 1. 基线与提交

| 项 | 值 |
| --- | --- |
| 起始基线 | `5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1`（`main`，PR #19 合并） |
| 修复分支 | `agent/hephi-r2-remediation`（**本地分支，未推送、未提 PR、未合并**） |
| R1 提交 | `9e874f85c995b945f8408be46f51fb34661ebaa2`（activation v2 规范化哈希） |
| R2 提交 | `0d7c031e24ec9aed16cf296a99336e501d3c1fac`（dirty 构建拒绝、完整 commit 身份） |
| R3 提交 | `0d58bc39ed246c6c9084766c6b495ce2300795d4`（R3 独立验证见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md)） |
| 执行环境（本记录的实测时点） | macOS 27.0.1 / arm64；Node `v26.1.0`、pnpm `11.7.0`、tsdown `0.22.14`（R3 提交后已在 Node `v22.19.0` 复跑全量，见 R3 验证记录） |
| 方案指定环境 | Node `22.19.0`、pnpm `11.7.0` → **Node 不一致，最终验收仍阻塞** |

## 2. 实际执行的命令与退出码

cwd 均为 `hephi/`；时间 2026-11-07（+08:00），运行窗口 06:42–06:44。

| 命令 | 退出码 | 结果摘要 |
| --- | --- | --- |
| `pnpm test`（第 1 次） | 0 | **19 文件 / 201 tests passed**；start `06:42:43`，duration `35.48s`（transform 2.24s / import 4.65s / tests 117.69s） |
| `pnpm test`（第 2 次，显式捕获退出码） | 0 | **19 文件 / 201 tests passed**；start `06:47:43`，duration `38.83s`（transform 2.37s / import 5.13s / tests 133.39s） |
| `pnpm typecheck` | 0 | `tsc --noEmit` 无输出 |
| `pnpm build`（**当时**工作树含 R3 未提交改动 → dirty） | **1** | `ERROR  Error: refusing to build from a dirty working tree: commit or clean tracked, staged and untracked files before building` |
| `pnpm test:unit` | 0 | 7 文件 / 53 tests passed（519ms） |
| `pnpm test:integration` | 0 | 12 文件 / 148 tests passed（36.65s） |
| `pnpm exec vitest run tests/control/activation.test.ts` | 0 | 30 tests passed（含 R1-T01–T12） |
| `pnpm exec vitest run tests/control/build-commit.test.ts` | 0 | 9 tests passed（R2-T01–T08 + 配置惰性断言） |
| `python3` 独立实现复算 R1-T12 固定夹具 | 0 | 输出 `sha256:14756a3ee1178fcbb8170983322ceb954c9661d8744af15a02ea9761fa1b5c50`，与测试内登记期望值一致 |

证据路径：第 1 次运行的原始输出**未归档**；第 2 次复跑原始输出在 `/tmp/r4-test.log`（本机临时目录，不入库）。复算脚本为一次性临时脚本（`/tmp/verify_r1_t12.py`，本机临时目录，未归档），算法与输入见 §4.1，可复现。提交前建议把上述原始输出复制到证据目录并由 R5 独立复跑。

> 本表 19 文件 / 201 tests 是 **R3 提交前**的运行记录（时点保留）。R3 `0d58bc3` 提交后当前全量为 **20 文件 / 202 tests**（2026-11-07 06:51:38，Node `v22.19.0`、pnpm `11.7.0`），见 [`docs/remediation-r3-validation.md`](remediation-r3-validation.md)。

## 3. R1 设计决策落实（清单 R1.1）

| 条目 | 状态 | 依据 |
| --- | --- | --- |
| 新写入 `version: 2` | 已实现 | `prepareActivation` 写 `version: 2`；R1-T05 |
| 递归键排序、数组保序、空白不参与哈希 | 已实现 | `canonicalize()`／`canonicalPayload()`（`hephi/src/control/activation.ts`）；R1-T01／T02／T03／T05 |
| 保持 JSON 语义（undefined、数字、布尔/null、不做 Unicode 归一化） | 已实现 | `canonicalize()` 实现与注释；R1-T12（中文/空格夹具） |
| v1／无版本合同按原 `JSON.stringify` 键序验证、不改字节与 hash | 已实现 | `legacyPayload()`／`legacyContractHash()`；R1-T06／T07／T08 |
| 未知版本先验 stored hash 再拒绝并给重新 prepare 指引 | 已实现 | R1-T09 |
| 先验 stored hash，再解释 `executionMode`／`enforcement` | 已实现 | R1-T11 |
| 未知顶层字段仍拒绝 | 已实现 | R1-T10 |
| `versioning.md` 登记 v1／v2 矩阵、规范化规则、迁移方式 | 已实现 | `hephi/docs/versioning.md` §2.1、§3 |

## 4. R1-T01–T12 结果

测试文件：`hephi/tests/control/activation.test.ts`（全部通过）。

| 用例 | 结果 | 位置 |
| --- | --- | --- |
| R1-T01 顶层键序 | 通过 | L279 |
| R1-T02 嵌套键序 | 通过 | L285 |
| R1-T03 数组保序（交换即变 hash） | 通过 | L292 |
| R1-T04 语义篡改 + stale hash 拒绝 | 通过 | L301 |
| R1-T05 新合同 version=2、规范化重算、空白容错 | 通过 | L312 |
| R1-T06 v1 合同原样加载、hash 不变 | 通过 | L324 |
| R1-T07 无版本 legacy 原样加载、不自动升版 | 通过 | L337 |
| R1-T08 v1 重排键 + 规范化 hash → 拒绝（无静默迁移） | 通过 | L351 |
| R1-T09 未知版本拒绝 + 指引 | 通过 | L361 |
| R1-T10 未知顶层字段仍拒绝 | 通过 | L371 |
| R1-T11 先报 hash mismatch、不用非法模式 | 通过 | L380 |
| R1-T12 固定夹具与独立实现 SHA256 一致 | 通过 | L389 |

### 4.1 R1-T12 独立复算

算法：递归按对象键升序排序（本夹具键均为 ASCII，UTF-16 code unit 排序与码位排序一致）；数组保持原顺序；`undefined` 丢弃；`json.dumps(canonical, ensure_ascii=False, separators=(',', ':'))`；SHA256 的 UTF-8 字节。独立 Python 实现输入（固定夹具，与测试一致）与该实现输出字节：

```text
{"allowedPaths":["src/**","文档/**"],"baseRef":"main","baseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","enabled":true,"enforcement":"enforce","executionMode":"native","issueNumber":42,"plugin":{"commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","version":"0.1.0"},"repository":"paxxie2/dubbo","requirePullRequest":true,"task":{"acceptance":[{"check":"unit","id":"AC1","paths":["src/**"],"text":"文本 with space"}],"goal":"目标 中文","outOfScope":[],"protect":["**/tests/**"],"version":1},"ticketId":"T-中文 1","verification":{"checks":[{"args":["-e","console.log(\"hi\")"],"command":"node","cwd":".","id":"unit","kind":"test","purpose":"purpose 中文","required":true,"timeoutMs":1000}],"version":1},"version":2,"workspace":"/tmp/work space/中文"}
```

期望值 `sha256:14756a3ee1178fcbb8170983322ceb954c9661d8744af15a02ea9761fa1b5c50` 与测试内登记值一致。

## 5. R2-T01–T08 结果

测试文件：`hephi/tests/control/build-commit.test.ts`（全部通过，9 用例）。

| 用例 | 结果 | 位置 |
| --- | --- | --- |
| R2-T01 干净 Git 返回完整 HEAD | 通过 | L21 |
| R2-T02 已跟踪 dirty → 抛错 | 通过 | L25 |
| R2-T03 暂存 dirty → 抛错 | 通过 | L29 |
| R2-T04 未跟踪 dirty → 抛错 | 通过 | L33 |
| R2-T05 `HEPHI_BUILD_COMMIT` 不能绕过 dirty | 通过 | L37 |
| R2-T06 无 git 无变量 → 抛错（无静默 unknown） | 通过 | L42 |
| R2-T07 无 git + 完整 SHA → 接受 | 通过 | L46 |
| R2-T08 短 SHA／`unknown`／空／非十六进制／`-dirty` → 全部拒绝 | 通过 | L51 |
| 配置以惰性函数导出（导入不执行 git） | 通过 | L57 |

真实负例（间接机制证据，非清单 R2.3 验收）：R1/R2 复核时工作树因 R3 尚未提交而 dirty（已跟踪修改 + 未跟踪文件），`pnpm build` 真实进程 **exit 1**，错误文本如上表 §2；说明 dirty 拒绝在真实 Git 状态上生效。但该 dirty 内容是 R3 工作改动而非 `DIRTY_PROBE` 探针，只作机制证据，不替代 R2.3。（R3 已提交 `0d58bc3`；当前工作树仅 `docs/` 有 R4 同步改动未提交。）

## 6. 未验证项（明确登记）

| 项 | 状态 | 原因／下一步 |
| --- | --- | --- |
| R2.3 独立克隆 dirty 负例（探针文件 → `pnpm build` 非零；清理后干净构建成功且 `describePlugin().commit == HEAD`） | **未验证** | 需独立克隆/工作树；本轮未做 |
| 无 git 源码归档：无变量失败、显式完整 SHA 成功 | **未验证** | 仅有 mock 单测 R2-T06／T07；未做真实归档实测 |
| `pnpm check` 全量（含构建）在最终干净提交上通过 | **未验证** | 当前工作树 `docs/` 有 R4 同步改动未提交；R5 需在最终干净提交复跑（含构建） |
| 指定 Node `22.19.0` 下复跑 | **已验证（R3 提交后复核）** | 2026-11-07 06:51 在 Node `v22.19.0` / pnpm `11.7.0` 下跑全量 **20 文件 / 202 tests** 与 44 假宿主断言通过（见 R3 验证记录）；R1 专项命令未在该环境单独重跑 |
| R1 v2 新合同样例、v1／无版本只读样例、独立夹具字节文件归档 | **未归档** | 夹具字节已在 §4.1 记录；合同样例未落盘 |
| P5 真实宿主端到端（prepare→重启→挂载、进行中工单升级拒绝） | **未验证** | 本轮未做真实宿主验收 |
| 独立复核（非实现者从最终提交重新克隆复跑） | **未做** | 本次命令由执行 Agent 单会话运行，不能替代独立验收 |

## 7. 复核者

| 角色 | 身份 | 时间（+08:00） |
| --- | --- | --- |
| R1 实现 | `9e874f8` 作者（DSH Agent） | 2026-11-07 06:27 |
| R2 实现 | `0d7c031` 作者（DSH Agent） | 2026-11-07 06:28 |
| 命令复跑与本记录 | `docs-r4` 执行 Agent（**非 R1/R2 实现者，但同属本轮 Agent 会话**） | 2026-11-07 06:42–06:45 |
| 独立复核 | **未做** | 需独立会话执行 R5.2／R5.4 |
