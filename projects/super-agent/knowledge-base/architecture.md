# 架构与生命周期

## 1. 设计定位

上游 `README.md:1-9` 把项目定义为 DeepSeek Harness bundle 中的单仓库 proactive coding agent：从 GitHub（可选 Feishu）收事件，经主 Session 评估和路由，在每个 Ticket 的独立 DSH Session/目录中工作，再回到原会话交付。README 同时明确这是 research prototype，不是官方产品或生产就绪版本。

设计原则来自 `docs/000-philosophy.md`：尽量少占用人的注意力，只在被请求或团队规则允许时行动；只在人员需要决定或可以使用结果时发消息；诚实说明未完成、阻塞和风险。

## 2. 唯一主链

```text
Source
  -> Trigger（不可变事件）
  -> Thread（按 Source 组织的时间序列）
  -> Eval（gate + assessment）
  -> Decision（accept / stop / ignore / unavailable）
  -> Mandate（授权依据、范围、强度、Policy 版本）
  -> Ticket（有授权的工作单元）
  -> Assignment（一次执行绑定）
  -> Executor Session + directory
  -> Report / Attention / Channel reply
```

证据：`docs/001-domain.md:5-19,23-43,77-112`；实现对应 `src/core/intake.ts`、`src/core/evals.ts`、`src/core/tickets.ts`、`src/core/assignments.ts`、`src/core/replies.ts`。

### 关键区分

- **Eval 与订阅 fan-out 不同**：Ticket 订阅的 Thread 消息直接作为上下文进入 Ticket；这不新增授权。无 Ticket 所有权的消息才进入 Eval。
- **Mandate 与 Ticket 状态不同**：Ticket 结束不会自动撤销 Mandate；人的 stop 或恢复前 revalidation 失败才会撤销/拒绝继续。
- **Ticket 与 Assignment 不同**：Ticket 可 handoff、resume、retry 或换 Assignment；Executor 不能自行宣布 stop。
- **Context-only subscription 不拥有 follow-up**：只提供相关 Thread 上下文，不会让人类消息唤醒 ended Ticket。

## 3. 授权与评估

`docs/002-authorization.md` 和 `src/policy.ts` 共同定义：

1. Source 先决定是否监听该事件、是否在该 scope 接收 unaddressed 事件。
2. Gate 根据 Source-native actor、是否 mention/direct、allowed list、bot list、已有 Ticket ownership 得到 `explicit` / `inferred` / `not admitted`。
3. Assessment 对每条启用规则给出一次 judgement；接受必须有 settled direction、matched rule、intent evidence。
4. `off` 禁止 inferred；`observe` 记录“would accept”但不接单；`auto` 才能接收 positive inferred candidate。Explicit request 在三种模式都可用。
5. Policy 版本变化会丢弃进行中的 Eval、通知受影响 live Ticket；恢复 ended Ticket 前按原始依据 revalidate。

实现证据：`src/policy.ts` 的 `settingsPolicy`、`gate`、`revalidate`、`assessmentOutcome`、`policyVersion`；`tests/policy.spec.ts` 覆盖跨 Source 身份隔离、follow-up、bot/CI、observe/auto。测试是机制证据，不等于真实 GitHub/Feishu 鉴权已验证。

## 4. Engine 与唯一写入者

`src/core/engine.ts` 的 `Engine` 是 Triggers、Threads、Decisions、Tickets、Assignments 的唯一 writer；命令同步执行、在一个 transaction 内改变 aggregate，外部副作用通过 port 在 commit 后排队。角色只拿所需 `Pick` 接口：Sources、Main Session、People、Settings、Executor。

`docs/007-architecture.md:44-109,255-274` 给出的不变量：

| 状态 | 唯一 writer |
| --- | --- |
| Trigger / Thread / Decision / Ticket / Assignment | `Engine` |
| Source cursor 与 Source-owned meta | 对应 Source，经 `SourceContext` |
| Settings/history | `Settings` |
| Prompt versions | `Prompts` |
| Effects rows | `Effects` |
| Outbox receipts | `Outbox` |
| Health entry | 注册时 claim 的唯一责任方 |

这避免了 delivery、summary 或 worker 自行制造终态；终态必须走 Engine/Assignment/Reply 事实链。

## 5. Runtime、Effects、Outbox

- `src/app/runtime.ts` 是 composition root：锁住 `stateDir`、打开 SQLite Store、构造 Setup/Prompts/Effects/SourceRegistry/Sessions/Settings/DshExecutor/MasterAssessor/Outbox/Engine/Passes。
- 初始化顺序：注册 management routes → setup → 安装 Session/Executor hooks → 确保 master Session → policy sync → resume interrupted Assignments → 启动 passes/effects → `ready`。
- `src/app/passes.ts` 每两秒以及命令触发时 pump；先处理 due effects，再 `Engine.evaluateDue`。暂停只停 dispatch/Eval timeout/delivery/reply，Source 仍记录 Trigger，当前 worker turn 不被打断。
- `src/app/effects.ts` 是 durable queue：transaction 内 enqueue，commit 后执行；按 kind/key 合并 waiting payload；`Later` 不增加失败次数；普通失败指数退避并在连续失败后进入 health。
- `src/app/outbox.ts` 是 Channel reply 唯一 receipt writer；同一 Ticket/conversation 保序，Source off 时等待，目标 gone/ignored 时记录 dropped。Source channel 应使用稳定 message id 做幂等。

关键效果（来自 `docs/007:164-181`）：assessment/relay/notice/delivery 通常 2 秒起、最大 60 秒；launch/reply 有更长退避；launch 的 provider/network transient 才重试，prepare 失败不自动重试。

## 6. Executor 生命周期

`src/executor/dsh.ts` 为每个 Ticket 创建 `worker-<ticketId>` Session 和目录：

1. `start`/`deliver` 只 enqueue `launch`/`delivery` effect。
2. 首次 Assignment 前在 execution root 执行 panel 配置的 prepare command，`sh` 最长 10 分钟；失败直接让 Ticket failed。
3. `WorkerSlots` 限制并发；人类 follow-up 有一个额外优先 slot。
4. Input 按顺序投递；Session 事件记录 `inputsRead`；turn 结束后依据 Report/Attention/后台任务决定 handoff、waiting 或继续。
5. shell jobs/subagents 运行时占 slot；最多 30 分钟，超时杀 shell jobs；handoff 后 shell job 可留给人工但不再唤醒 Executor。
6. 重启按 Ticket oldest-first 发送 recovery note，避免重复外部副作用前先检查目录、git history 与 GitHub。

Ticket stages 的优先级在 `src/core/stage.ts`：输入未送达 → 等人回答/评审/阻塞失败 → queued → waiting → working。`ready`、`dropped` 及 pull-request closure 规则共同决定终态。

## 7. Source 适配

GitHub 与 Feishu 都通过 `src/sources/kind.ts`/`SourceRegistry` 注入：

- GitHub：通知、Issue/PR/comment/CI 观察开关、PR 线程和 CI poll、评论/评审回复、branch/PR 绑定；见 `src/sources/github.ts`、`github-trigger.ts`、`github-pull.ts`、`github-channel.ts`、`github-read.ts`。
- Feishu：live event、history recovery、订阅 topic poll、bot-only channel、chat membership sync；见 `src/sources/feishu.ts`、`feishu-loops.ts`、`feishu-trigger.ts`、`feishu-channel.ts`、`feishu-read.ts`。

`docs/008-cookbook.md:19-328` 的 webhook 示例固定了扩展不变量：稳定 Trigger/Thread/Channel id、Source-owned meta、scope 与 admission rows、idempotency key、bounded threadContext、无凭据环境变量、cursor 在所有 Trigger durable 后才推进、每项 schema 校验、健康状态和 AbortSignal。

## 8. 最高风险

- `docs/003:23-29`、`docs/006:13-20`：router/worker 使用 `danger-full-access`，以 operator OS user 运行，可读 home、可用绝对路径执行；wrapper/blockedCommands 不是隔离边界。
- `docs/003:76-80`：凭据 wrapper 只是默认路由；worker 可以绕过命令名约束通过绝对路径执行。
- `docs/007:614-617`：Trigger actor/thread membership 哪些字段可信仍是开放问题；本仓库没有密码学来源证明。
- `src/sources/github-trigger.ts`、`src/sources/github.ts`、`src/sources/github-channel.ts`：静态审计发现 Trigger/Channel 未持久化 repository，`scope`/channel default 也未显式拒绝旧 repository；切换配置后旧 Ticket/同号 Issue/PR/pending reply 的路由需 targeted test，当前未验证。
- `src/app/http.ts`：loopback + header + same-origin 约束是 transport boundary，不是 OS-user authorization；panel API 保存拥有较高权限，需本机威胁模型。
- `src/sources/feishu-loops.ts`：`Promise.allSettled` 的 backfillLoop rejection 需专门验证是否能正确反映 `history` health；目前静态审计标记为未验证。
