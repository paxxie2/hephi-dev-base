# 2026-11-04 site-pnl-diagnosis HEPHI 接入验证

- 分支：`codex/optional-execution-modes`
- 项目：`paxxie2/site-pnl-diagnosis`
- 主助手给出的已合并主分支 SHA：`e00f338b098546adc40156dc15b4b6559e19835d`
- 本轮不修改 Skill、阶段策略、提示词、Super Agent/DSH 源码或运行配置。
- 结论：prepare 仓库映射、Issue 显式模式选择、Python/vitest JUnit 目标发现和强制 reverse 适配已完成并自测；**真实 Issue #4/#5 的 prepare/Worker/ready 端到端未执行**。

## 先回退未经授权的验证策略

上一轮未经授权新增的 `VerificationPolicy`/`new-feature`、可选 `reverseTestCommand`、KB nullable reverse 等语义已全部撤回：

- `ActivationContract.reverseTestCommand` 恢复为必需字段；
- 没有 `verificationPolicy` 字段、没有 `new-feature` 分支、没有跳过 reverse；
- verifier 仍固定执行 forward 与 clean-base reverse；
- 反向报告必须来自真实目标测试失败；collection/环境/结构错误为 `blocked`，不会被当作 reproduce。

本报告不把任何 fixture 称为真实端到端。

## 本轮修改

1. `scripts/prepare-dubbo.sh`
   - 识别精确仓库 `paxxie2/site-pnl-diagnosis`，使用 `HEPHI_SITE_PNL_SOURCE`（默认本机现有 clone）创建 Ticket worktree。
   - 通过 API 的 `main` SHA 创建 base worktree；对 site-pnl 使用 gh credential 的 HTTPS fetch，避免依赖本机过期 `main`。
   - 设置项目允许路径、forward/reverse 命令、PR 要求。
   - 只在 site-pnl 读取 Issue title 并通过 `HEPHI_ISSUE_TITLE` 交给 prepare；缺少/冲突的 `[native]`/`[staged]` 标记失败。
2. `src/control/activation.ts`
   - `parseIssueExecutionMode`：标题必须恰含一种显式模式标记；冲突、缺失、与显式 env 冲突均拒绝。
   - prepare 从标题写入 `executionMode`；原有合同必需 reverse 字段不变。
3. `src/verification/parser.ts` / `runner.ts`
   - Surefire/JUnit 解析支持 `<testsuites>` 容器并汇总全部 `<testsuite>`，不再只读第一个 suite。
   - runner 增加显式 `junit` parser 别名（仍走同一真实报告解析，不改变 pass/fail 语义）。
4. `src/control/dubbo-verifier.ts`
   - site-pnl 目标发现：仅 AM 的 `backend/tests/test_*.py` 与 `web/src/**/*.test.ts(x)`，分别映射 `::site-pnl.backend` / `::site-pnl.frontend`；只有生产改动、没有新增/修改测试时保持 blocked。
   - 报告 ID 对 site-pnl 使用报告文件名对应的组名；forward/reverse 都使用真实 JUnit 报告。
   - 无新增/修改目标测试时仍然 `no changed reproduction test is present`；reverse 仍要求目标报告实际 failure 且无 errors/skips。
5. `scripts/run-site-pnl-tests.mjs`
   - forward：只运行本 Ticket 新增/修改的 pytest/vitest 目标，写真实 JUnit。
   - reverse：从 `HEPHI_BASE_COMMIT` 创建干净临时 worktree，仅移植新增/修改测试及测试支持文件，运行目标测试；不移植业务实现。
   - 报告缺失/0 testcase 直接失败；pytest collection error、vitest 加载错误或环境错误不会被解释成 reproduce。
   - 前端缺 `node_modules` 时执行 `npm ci`；不新增独立运行时。

## 验证结果（原始日志）

完整日志与真实退出码位于：

- `docs/validation/2026-11-04-site-pnl-hephi-check.log` / `.exit`
- `docs/validation/2026-11-04-site-pnl-host.log` / `.exit`
- `docs/validation/2026-11-04-site-pnl-project-check.log` / `.exit`
- `docs/validation/2026-11-04-site-pnl-prepare.log` / `.exit`
- `docs/validation/2026-11-04-site-pnl-adapter-forward.log` / `.exit`
- `docs/validation/2026-11-04-site-pnl-adapter-reverse.log` / `.exit`
- `docs/validation/2026-11-04-site-pnl-diff-check.log` / `.exit`

### HEPHI 插件检查

```text
$ pnpm check
Test Files  19 passed (19)
     Tests  134 passed (134)
  Duration  19.98s
✔ Build complete in 730ms
exit 0
```

### 现有宿主 fixture（回归）

```text
$ node scripts/check-stage-host.mjs <installed-dsh-node_modules>
PASS: real installed DSH tool dispatch/scoped visibility/guard/progress events;
fixture Agent/report/jobs, not Worker or Issue E2E
exit 0
```

这是既有阶段控制 fixture；本轮没有修改阶段策略，也不是 site-pnl E2E。

### site-pnl 项目 check（临时只读副本）

```text
$ .venv/bin/python -m pytest backend/tests -q
139 tests, 1 skipped (真实模型手工用例默认 skip), exit 0
$ npm --prefix web run typecheck
exit 0
$ npm --prefix web test -- --run
Test Files  7 passed (7)
     Tests  59 passed (59)
exit 0
$ npm --prefix web run build
built in 443ms
exit 0
```

项目源码不在本仓库中修改；这是在临时副本执行，`node_modules`/`.venv` 来自现有项目工作树。

### prepare 集成（本地完整 main 副本 fixture）

`prepare.log` 使用本地 source repo + fake GitHub API 返回，验证：

- `[native]` → contract `executionMode: native`，repository/site base/test+reverse 命令正确，`verificationPolicy` 不存在；
- `[staged]` → contract `executionMode: staged`；
- `[native] [staged]` → prepare exit 1，activation 不存在；
- 无模式标记 → prepare exit 1，activation 不存在。

该 fixture 的 base 是本地完整 main 副本 `c3fbbb5...`，不是主助手给出的远端 `e00f338...`；它验证接线，不是真实 Ticket prepare。

### 测试适配器真实命令（合成目标 fixture）

在临时完整项目副本中新增一个仅在当前 worktree 成立的后端探针测试：

- forward：`1 passed`，JUnit `tests=1 failures=0 skipped=0`，exit 0；
- reverse：base worktree 缺对应实现，目标测试实际 `FAILED`，JUnit `tests=1 failures=1`，exit 1。

reverse 的非零退出符合“发现真实目标失败”；不是编译/环境错误。此探针只验证适配器，不是产品业务测试，也不是端到端。

### 空白检查

```text
$ git diff --check
(no output)
exit 0
```

## 限制与部署前提

- **真实端到端未验证通过**：未对 Issue #4/#5 重新 prepare，未创建真实合同/intent，未重新挂载真实 Worker，未运行真实业务增量测试，未调用 ready。
- 本地 source clone 的 `main` 仍是旧空基线；主助手给出的 `e00f338...` 未在本地存在。真实 prepare 依赖宿主用 gh credential fetch 该 main。
- 项目 check 在临时副本执行，复用现有依赖；新 Worker worktree 首次运行可能需要 `uv sync`/`npm ci`（适配器对前端会补 `npm ci`）。
- 未运行真实浏览器/真实 DeepSeek/黑盒全旅程；本项目 check 的 pytest 有 1 个真实模型手工用例默认 skip，不能据此声称真实模型通过。
- 没有新增 reverse 放行策略；阶段/模式语义未改。

## 宿主重载与 retry

- 本轮源码和 `lib` 构建已更新；正在运行的 DSH 进程不会自动加载新插件代码，需要主助手按现有部署方式重载/重启宿主（不在此执行）。
- prepare 脚本直接调用已构建的 `lib/cli.mjs`，因此重载后对 blocked Ticket 使用现有公开 retry/重新派发即可让 prepare 重跑。
- Worker 的已挂载 gate 需要重新创建/重新挂载才能读取新 `lib`；对 Issue #4/#5 用既有 Super Agent retry/重新启动流程，不手写合同或 intent。
- 主助手负责真实 retry、PR/部署；本轮未推送、未部署、未重启、未创建远程或 Issue。
