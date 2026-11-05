# 源码与测试索引

## 1. 根目录

| 路径 | 作用 | 关键证据 |
| --- | --- | --- |
| `README.md` | 定位、限制、文档顺序 | research prototype / non-production |
| `SETUP.md` | 低打扰安装问答协议与执行顺序 | probe、逐问、计划确认、operator secrets |
| `package.json` | 版本、engines、bundle/client 注入、scripts | `check = typecheck + test + build` |
| `cordis.patch.yml` | dsh-superagent、GitHub/Feishu plugins、router/worker presets | Feishu 默认 disabled；worker/router preset |
| `scripts/dsh-superagent` | start/stop/restart/status | exit 0/1/2/3、PID/tmux/stop marker |
| `examples/profile.cordis.patch.yml` | profile machine config 示例 | stateDir、port、limits |

## 2. Core（无 I/O 的领域层）

| 路径 | 关键职责 |
| --- | --- |
| `src/core/model.ts` | Trigger、Disposition、Mandate、Evaluation、Decision、Assignment、Ticket、Input 类型与谓词 |
| `src/core/ids.ts` | 稳定 `key()` id（由输入 hash 得到） |
| `src/core/engine.ts` | 唯一 domain writer；按角色导出 Engine 接口；事务命令 |
| `src/core/intake.ts` | dedupe、scope/filter、Thread、fan-out、Eval queue |
| `src/core/evals.ts` | gate、batch、assessment、deadline、Decision、requeue |
| `src/core/tickets.ts` | create/attach/wake/stop/retry/end、Subscriptions、Inputs |
| `src/core/assignments.ts` | worker callbacks、input read/delivery、Report、attention、终态 |
| `src/core/replies.ts` | acknowledgement/answer/result/attention 的合法性与 Outbox request |
| `src/core/stage.ts` | Ticket stage 与 retry eligibility |
| `src/policy.ts` | settings schema、gate、revalidate、assessmentOutcome、Policy hash/effects |
| `src/core/ports.ts` | Repositories、Policy、SourceScope、Assessor、Executor、Outbox ports |
| `src/core/memory.ts` | domain test 的 structuredClone/snapshot rollback memory repositories |

## 3. App / runtime glue

| 路径 | 关键职责 |
| --- | --- |
| `src/app/runtime.ts` | composition root、startup/shutdown、依赖注入、健康与 notices |
| `src/app/store.ts` / `store-read.ts` | SQLite persistence 与只读 queries |
| `src/app/migration.ts` | schema migration（当前文档指 schema 11） |
| `src/app/effects.ts` | durable effect queue、coalesce、backoff、health |
| `src/app/outbox.ts` | receipt writer、ordered reply effect、channel send/drop |
| `src/app/passes.ts` | 2 秒 pump：effects → evaluateDue |
| `src/app/settings.ts` / `versions.ts` | revisioned settings、Policy changes、history |
| `src/app/prompts.ts` / `context.ts` / `skill-files.ts` | prompt version、组装、packaged text/skills |
| `src/app/sessions.ts` | main/worker Session、role model/preset、prompt revision binding |
| `src/app/assessment.ts` | bounded MasterAssessor、eval schema、assessment effect |
| `src/app/tools/main.ts` | orchestrator route/eval/read/note/attach/report 等 tools |
| `src/app/tools/executor.ts` | worker ack/report/reply/follow/context/PR tools |
| `src/app/http.ts` / `api.ts` | localhost Management API 与 typed routes |

## 4. Executor / Sources / Infra

| 路径 | 关键职责 |
| --- | --- |
| `src/executor/dsh.ts` | worker Session + directory、prepare、WorkerSlots、delivery、restart、background |
| `src/executor/background.ts` | shell jobs/subagents 的 quiet/kill/collect/stop |
| `src/sources/kind.ts` | SourceKind protocol |
| `src/sources/registry.ts` | kind/instance/health/policy/channel/context registry |
| `src/sources/github.ts` | GitHub poll、plugin entry、Source config |
| `src/sources/github-trigger.ts` | comments/reviews/Issue/CI → Trigger |
| `src/sources/github-channel.ts` | issue/PR/review reply、idempotency marker |
| `src/sources/github-pull.ts` | claim/observe PR、close/merge、Ticket binding |
| `src/sources/github-read.ts` | CI/repository/thread context/resources |
| `src/sources/feishu.ts` | Feishu plugin entry/config/scope/policy |
| `src/sources/feishu-loops.ts` | live events/history backfill/subscribed topic polling |
| `src/sources/feishu-channel.ts` | bot threaded reply/idempotency |
| `src/sources/feishu-read.ts` / `feishu-image.ts` | message/thread/attachment context |
| `src/infra/commands.ts` | CLI transport、repo path validation、JSON item validation |
| `src/infra/environment.ts` | worker shims/gitconfig/env/token removal；非安全边界 |
| `src/infra/health.ts` | health entry claim/report |

## 5. 测试地图

- `tests/policy.spec.ts`：authorization/gate/revalidation/assessment 机制。
- `tests/core-engine.spec.ts`、`runtime.spec.ts`、`runtime-concurrency.spec.ts`：核心生命周期、并发、恢复。
- `tests/effects.spec.ts`、`outbox.spec.ts`、`delivery.spec.ts`：durable queue、retry/backoff、order、receipt。
- `tests/environment.spec.ts`、`commands.spec.ts`、`service-script.spec.ts`：wrapper、credential、repo path、CLI/script 边界。
- `tests/sources.spec.ts`、`github-read.spec.ts`、`feishu-read.spec.ts`、`feishu-image.spec.ts`：Source translation/poll/read/channel 机制。
- `tests/panel-*.spec.tsx`、`views.spec.ts`、`styles.spec.ts`：panel/view/client。
- `tests/docs.spec.ts`、`class-docs.spec.ts`：文档与索引完整性。

测试大量使用 temporary SQLite、fake host、spy CLI、fixtures；它们可以证明机制和回归，不证明真实账号、网络、provider、DSH profile 或远端副作用。

## 6. 推荐定位顺序

1. 先读 `docs/001-domain.md` 与 `docs/002-authorization.md`；
2. 再读 `docs/003-execution.md`、`docs/007-architecture.md`；
3. 追 `src/core/engine.ts` → `intake.ts`/`evals.ts`/`tickets.ts`/`assignments.ts`；
4. 追 `src/app/runtime.ts` → `effects.ts`/`outbox.ts`/`sessions.ts`；
5. 最后追 Source 和 infra；
6. 用对应 `tests/*.spec.ts` 对每个结论做机制复核。
