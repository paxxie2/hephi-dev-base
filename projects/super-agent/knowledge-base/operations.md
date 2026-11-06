# 部署、运行与安全边界

## 1. 适用前提

`docs/006-deployment.md:21-27` 要求 Node 22.19+ 或 24+、pnpm、git 2.32+、Python 3.8+、tmux、GitHub CLI 2.48+；GitHub Enterprise Server 不支持；Feishu 另需 `lark-cli`。还需要 DSH profile 的模型 provider。

本次机器探针（2026-11-01）实际看到：Node `v26.1.0`、git `2.54.0`、tmux `3.6a`、Python `3.14.2`、DSH `0.2.1-rc.3`、`lark-cli` 在 PATH；`gh` 未安装。pnpm 调用触发了 pnpm 11.7.0 自管理目录写入并报 `EPERM`，因此依赖安装与回归未完成。

## 2. 安全安装顺序

不要跳过 `SETUP.md` 的交互纪律：

1. 只读 `SETUP.md` 与 `docs/000-philosophy.md`，执行一次 probe；
2. 按 Source → repository/account → allowed list → checkout/identity/auto-merge 逐条问，每次只问一个问题；
3. 收齐答案后一次性展示完整 plan，等 operator 确认再执行；
4. secret、账户创建、CLI 登录等必须由 operator 在自己的终端完成，绝不要求其在聊天粘贴 token/secret；
5. 先安装专用 profile、插件、machine config，再经 panel/API 保存 Sources、Policy、Execution、Prompts；
6. 首次使用 `observe`，审阅 Decision 与噪声后再考虑 `auto`。

### 账户隔离

- GitHub：专用 agent user + 独立 `GH_CONFIG_DIR` wrapper；agent 账号需要仓库写权限。
- Feishu：bot-only `lark-cli` 配置目录，`strict-mode bot`；host 会拒绝可作为 user 的 CLI。
- 推荐专用 OS 账号。仅仅使用 wrapper、`worker-bin` 或 `worker-gitconfig` 不会阻止 worker 读取 operator home。

## 3. profile 与启动

安装（仅新 profile）：

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
git clone <this-repository> dsh-superagent
cd dsh-superagent
pnpm install && pnpm build
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$PWD"
```

然后复制 `examples/profile.cordis.patch.yml` 到 profile，填绝对 `stateDir` 和端口；Feishu 插件默认 disabled，确认 bot 后才启用。**已有 profile 不要再运行 `--from-default-profile`**，它会覆盖 `cordis.patch.yml`。

```sh
scripts/dsh-superagent start
scripts/dsh-superagent status
```

| exit code | 含义 |
| --- | --- |
| 0 | 正常运行 |
| 1 | 未运行、重复、无响应或 runtime error |
| 2 | 某 Source/Policy sync/effect 出错，重启通常不解决 |
| 3 | 正在等待 setup |

## 4. 关键配置

Panel 的 Settings → Sources / Policy / Execution / Prompts / Deployment 对应：

- GitHub：`owner/name`、agent CLI、observe Issues/PRs/comments/CI 开关（默认关闭）。编辑已有 Issue body 不会产生新的 GitHub mention trigger，应发新 comment。
- Policy：每个 Source 的 allowed 人员、bots、membership sync、admission table；不同 Source 的账号永不互相授权。
- Eval：`off`/`observe`/`auto`、timeout、assessment model。
- Execution：worker model、`maxWorkers`、directory root、prepare command、blocked commands。
- Prompts：team sections、built-in overrides、skills；修改 prompt 不改变 host gate、Mandate 或工具校验。
- Deployment：stateDir 与 machine limits；stateDir 不能在 panel 中修改。

本地 Management API（默认 `127.0.0.1:<port>/orchestrator/api`）要求：

- Host 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`；
- 必须带 `x-orchestrator-request: 1`；跨 Origin 返回 403；
- `PUT settings/<block>` 需要完整 value + revision；revision 过期返回 409；
- API saves 具备 panel 权限，能改 execution environment/setup fields；不要把它暴露到公网。

## 5. 运行观察清单

1. `status` 为 0，且 setup、runtime、Source、effects health 均正常；
2. Panel 的 Superagent sidebar 顺序：Overview → Source → Trigger → Eval → Execution → Settings；
3. Overview 先看需要人处理的 Ticket，再看 health 和历史；
4. 从 allowed account 发 `@<agent> <request>`，等待 polling interval，在原 conversation 观察 acknowledgement、worker Report 和最终 Channel；
5. 对每个 Ticket 核对 originating Trigger、Mandate、Policy version、Assignment、Report、PR/CI 和 reply receipt；
6. `observe` 下 inferred candidate 只能留下 would-accept 记录，不应实际创建 Ticket；
7. 真实联调必须保存命令、退出码、时间、profile、Source 配置和 trace；静态测试或 fake CLI 不得冒充端到端成功。

## 6. 失败、暂停与恢复

- **prepare failure**：10 分钟超时或非零退出，Ticket failed；修复 prepare 后由人 Retry，不会自动重试。
- **provider/network transient**：launch/turn 有限次退避重试；非 transient launch failure 进入 failed。
- **delivery failure**：Ticket 显示 Input undelivered，按 2 秒起退避；成功、新 Assignment 或 Ticket end 清除。
- **Outbox/channel**：按 Ticket/conversation 保序；Source off 等待；目标 gone/ignored 才永久 dropped，其他错误重试。远端已成功、客户端超时仍可能产生重复，必须依赖 Source idempotency marker/key。
- **blocked/failed**：自动 Input 暂停，人类消息或 Retry 才恢复；Session tools 保留，便于人工继续。
- **pause processing**：停止 dispatch、新 Eval、Eval timeout、Input delivery、replies；Source 仍收 Trigger，当前 worker turn 不取消；resume 后 deadline 平移。
- **restart**：运行 Assignment 结束并带 recovery note 重启，按 oldest Ticket 优先；数据库、Session、目录、Subscriptions、pending messages 持久化。
- **Feishu backfill**：静态代码显示 `Promise.allSettled` 聚合 loop；若 backfillLoop 发生未覆盖 rejection，是否能稳定更新 `history` health 尚需 targeted test，当前未验证。

## 7. 升级与回滚

```sh
# 先等待无 Executor turn
cp <stateDir>/orchestrator.sqlite <backup-path>
git pull
pnpm install
pnpm build
scripts/dsh-superagent restart
scripts/dsh-superagent status
```

升级前复核 prompt override 的 **Default updated**。数据库 schema 只向前迁移，新版本写过的 DB 不能由旧版本打开；回滚必须使用升级前 SQLite backup。DSH 本身升级后要重启正在运行的 profile，使 panel artifacts 匹配。文档示例是未 pin 的 `git pull && pnpm install && pnpm build`，未要求 `--frozen-lockfile`、commit/signature 或 artifact provenance；这属于 supply-chain/rollback 风险，非本次观察到的 exploit。

## 8. 已知安全缺口

- `danger-full-access` 与 operator OS 身份是最高风险；专用 OS account/sandbox 是建议，不是实现强制。
- blocked command 只拦命令名，basename shim 可被绝对路径绕过；worker 可能直接调用个人 `gh`/其他 CLI，Commands 的 repo path guard 不覆盖 worker shell。
- `executor.prepare` 是 panel 配置的 `sh -c`，同样在 full-access worker 环境执行。
- Management API 的 loopback + `x-orchestrator-request` + same-origin 是 transport boundary，不是 OS-user authorization；panel 权限可修改 setup account、prepare、environment，不能暴露公网，也不能假设本机任意进程不可信时已隔离。
- GitHub Trigger/Thread/Channel 当前静态实现未持久化 repository 身份；切换 repository 后旧 Ticket、同号 Issue/PR、pending reply 可能使用新 repository，需先停止旧工作/清理 outbox 并 targeted test。
- SQLite 历史和 outbox 无 retention；长期运行需外部容量/备份策略。
- 代码/单元测试没有证明真实 GitHub、Feishu、DSH provider、远端 idempotency 或公网隔离。
