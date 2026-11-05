# 研究证据与验证记录

## 1. GitHub 在线调研

研究先用 GitHub REST API 搜索候选：

```sh
curl -L --fail -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/search/repositories?q=dsh-superagent-prototype'
```

搜索 `deepseek super agent` / `dsh-superagent-prototype` 时同时出现社区项目（例如 `LofiSu/deepseek-super-agent`）和官方仓库；本交付选择 `deepseek-ai/dsh-superagent-prototype`，因为它位于 `deepseek-ai` 组织、README 明确面向 DeepSeek Harness，且源码/文档/测试完整可审计。社区项目未纳入本知识库，避免把非官方实现混称。

命中官方仓库：`deepseek-ai/dsh-superagent-prototype`，随后查询：

```sh
curl -L --fail https://api.github.com/repos/deepseek-ai/dsh-superagent-prototype
curl -L --fail https://api.github.com/repos/deepseek-ai/dsh-superagent-prototype/git/trees/main?recursive=1
curl -L --fail https://api.github.com/repos/deepseek-ai/dsh-superagent-prototype/commits/main
curl -L --fail https://api.github.com/repos/deepseek-ai/dsh-superagent-prototype/releases
curl -L --fail 'https://api.github.com/repos/deepseek-ai/dsh-superagent-prototype/issues?state=all&per_page=20'
```

本次观测：

- full name：`deepseek-ai/dsh-superagent-prototype`
- description：`Towards a More Autonomous Agent System`
- default branch：`main`
- license：MIT
- stars（查询时）：1323
- latest push：`2026-10-31T12:05:51Z`
- latest commit：`6337fc823ce20251c8de8085948165c81aaa701e`
- tree：216 个 tracked files，未截断；包含 docs 000-008、src、tests、prompts、两个 Source skills。
- releases/tags/issues：API 本次未返回可用 release、tag 或 issue；不能据此推断项目没有未来活动。

原始入口：[GitHub repository](https://github.com/deepseek-ai/dsh-superagent-prototype)、[commit](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/6337fc823ce20251c8de8085948165c81aaa701e)。

## 2. 本地 checkout 证据

```sh
git rev-parse HEAD
# 6337fc823ce20251c8de8085948165c81aaa701e

git status --short --branch
# ## main...origin/main

git remote -v
# origin -> git@github.com:deepseek-ai/dsh-superagent-prototype.git
```

源代码是通过 HTTPS clone（临时绕过本机全局 Git URL rewrite）得到的；checkout remote 保留上游 SSH URL，但本地研究没有向远端 push。

## 3. 静态研究证据

- `README.md:1-9`：prototype、非生产、与内部/论文实现可能不同、GitHub/Feishu 单仓 proactive agent。
- `package.json:47-57`：scripts、Node/DSH engines、pnpm 版本；`docs/006-deployment.md:75-83` 的安装示例 pin `0.2.1-rc.3`，与 `engines` 的 alpha.2 是版本差异。
- `SETUP.md:5-14,16-29,31-79`：probe、逐题、先计划后执行、operator 手动 secret、验证交接。
- `docs/001-domain.md:5-43`：Source/Trigger/Thread/Eval/Mandate/Ticket/Assignment/Subscription。
- `docs/002-authorization.md:5-20,46-75,91-155`：gate、explicit/inferred、off/observe/auto、revalidation、expiry。
- `docs/003-execution.md:5-80,118-203`：stage、worker、prepare、concurrency、retry/restart/pause/channel。
- `docs/004-prompts.md:5-16,44-71,73-96`：prompt assembly、precedence、team skills、version。
- `docs/005-panel.md:5-57`：panel tabs、quiet/honest state。
- `docs/006-deployment.md:5-27,71-227,233-274`：profile/accounts/install/API/setup/upgrade/troubleshooting。
- `docs/007-architecture.md:27-181,197-274,289-400`：Runtime/Engine/Store/Effects/Source/Executor/Sessions/one-writer/module index。
- `docs/008-cookbook.md:19-328`：Source 扩展稳定 ID、cursor、Channel、context、Policy、env、loop、health、abort。
- `src/policy.ts`、`src/core/*`、`src/app/*`、`src/executor/*`、`src/sources/*`：实现对应上述模型。

## 4. 实际命令与结果

| 命令 | 结果 | 证据强度 |
| --- | --- | --- |
| GitHub API metadata/tree/commit | 成功，得到上方 JSON 摘要 | 在线仓库事实 |
| HTTPS `git clone` | 成功，checkout clean at commit | 本地源码事实 |
| `node -v` | `v26.1.0` | 机器观测 |
| `git --version` | `2.54.0` | 机器观测 |
| `tmux -V` | `3.6a` | 机器观测 |
| `python3 --version` | `3.14.2` | 机器观测 |
| `gh --version` | 未安装（command not found） | 机器观测 |
| `dsh --version` | `0.2.1-rc.3` | 机器观测 |
| `command -v lark-cli` | `/Users/USER/.nvm/versions/node/v26.1.0/bin/lark-cli` | 机器观测 |
| `pnpm -v`（默认环境） | pnpm 11.7.0 自管理目录写入报 `EPERM`；这是初次探针失败 | 失败证据 |
| `PNPM_HOME="$PWD/.pnpm-home" PATH="$PWD/.pnpm-home:$PATH" pnpm install --frozen-lockfile` | 成功，lockfile supply-chain policy 通过（289 entries），235 packages installed | 真实本地安装 |
| `PNPM_HOME="$PWD/.pnpm-home" PATH="$PWD/.pnpm-home:$PATH" pnpm typecheck` | 成功，`tsc --noEmit` exit 0 | 真实本地验证 |
| `PNPM_HOME="$PWD/.pnpm-home" PATH="$PWD/.pnpm-home:$PATH" pnpm check` | 成功：59 test files / 1197 tests passed，tsdown build complete | 真实本地验证 |
| `python3 -c 'compile(...)'` on `scripts/dsh-superagent` | `syntax ok` | 静态语法观测 |
| 真实 DSH profile 启动 | 未执行 | 未验证 |
| 真实 GitHub/Feishu event、PR、CI、reply | 未执行 | 未验证 |

## 5. 证据分层

### 已确认（静态/在线）

- 上游 commit、文件树、许可证、package scripts/engines。
- 领域模型、唯一 writer、Policy 规则、retry 语义、Source 适配接口和设计风险。
- 本地 checkout 与命令探针结果。

### 仅机制证据

- Vitest、fake host、temporary SQLite、spy CLI、fixtures 可以证明代码分支、事务/回滚、幂等 marker、pagination 等机制。
- `tests/*` 不证明真实账号权限、远端 API、DSH provider、profile plugin graph 或真实 Channel delivery。

### 未验证

- 当前 DSH profile 是否挂载该 bundle / skill。
- 真实 setup、HTTP management API、GitHub/Feishu polling 与 outbound replies。
- `danger-full-access` 的真实 OS 隔离效果（代码文档反而明确不隔离）；worker 绝对路径绕过 blocked-command shim 的实际行为。
- GitHub repository 切换后旧 Ticket/同号 Issue/PR/pending reply 是否错误路由到新 repository；建议持久化 repo identity 或实现 channel.allowed 后做回归。
- loopback Management API 在本机不同进程威胁模型下的 OS authorization。
- 升级供应链约束（未 pin 的 `git pull`、signature/provenance）。
- Feishu `backfillLoop` fatal rejection 是否总能更新 `history` health；建议注入 `pollThreads` rejection 后观察 health/restart。

## 6. 最小复核命令

```sh
git status --short --branch
git rev-parse HEAD
node -v
pnpm install --frozen-lockfile
pnpm check
scripts/dsh-superagent status
```

其中后两条只有在依赖、profile、账号和 stateDir 都已配置后才有意义；不要用失败的环境探针伪造通过结论。

建议额外回归：

```text
1. 配置 repo A，创建/保留 Ticket 与 pending GitHub reply；切换到 repo B；确认旧 Trigger/Thread/Channel 不会读写 B 的同号对象。
2. 注入 Feishu pollThreads rejection；确认 history health、日志和 restart 行为。
3. 从本机非 panel-origin 进程请求 Management API，确认威胁模型与权限边界；不把 403 当作 OS 授权证明。
```
