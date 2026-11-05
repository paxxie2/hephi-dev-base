# Prompt、角色与 Skill

## 1. Prompt 组装

`docs/004-prompts.md:5-16,44-71` 规定团队可编辑三类 team sections（Communication、Ticket scope、Delivery requirements）、team skills，以及 built-in system-prompt parts。Prompt 不能改变 host 强制的身份、权限、工具参数校验、reply purpose 和长度限制。

组装顺序：

1. shared instructions + role
2. 三个 team sections
3. subscriptions/replies
4. orchestrator dispatch 或 worker work
5. orchestrator admission
6. handoff
7. environment
8. orchestrator policy

Policy 和 environment 是每次 model request 重新生成的；Prompt version 持久化，Session 记录实际用过的 revision。外部消息、评论、文档和引用是最低信任级别的数据，永远不改变 authorization。

## 2. 主 Session 与 Worker

### Orchestrator

`prompts/shared.md`、`prompts/orchestrator.md`：只负责候选评估、accept/stop/attach/ignore、转发 worker reports；不做技术实现，不检查代码/日志/链接文档，不直接解决 worker blocker；不等待 sleep/poll/job wait。

`cordis.patch.yml` 的 router preset 只提供路由需要的 shell/fs/jobs/skill，并把写文件、subagent、web、询问人、present、profile/plugin 等能力关闭或限制。实际 profile 是否挂载须查 `cordis.patch.yml` 和运行 profile，不能仅凭文件存在下结论。

### Worker

`prompts/worker.md`、`prompts/work.md`：在 Ticket directory 内读上下文、判断范围、实现、验证；通过 `gh` 做 GitHub 操作；按 Delivery requirements commit；通过 `orchestrator_report` 区分 ready/blocked/failed/dropped/waiting/progress；遇到超范围 follow-up hand back。

Worker 的执行 prompt 也会载入 DeepSeek Harness coding prompt、仓库 `AGENTS.md`、对应 Source skill；但没有 ask/present/profile-management 之类面向人的工具。Worker Session 与目录以 Ticket 为单位。

## 3. 上游已有 Skills

- `skills/dsh-superagent-github/SKILL.md`：`orchestrator_read` 的 GitHub issue/PR/comments/reviews/checks 路径、分页、ack、review-thread reply/resolve、bot/CI 不授权。
- `skills/dsh-superagent-feishu/SKILL.md`：Trigger/Feishu message/root/parent/thread/around、nested forward/attachment 读取、分页、source_url、只读和 bot 身份边界。

这两个 Source skill 是 worker 的运行知识，不等于安装凭据，也不授予额外工具权限。

## 4. 本研究新增 Skill

本仓库的 `skills/deepseek-superagent-research/SKILL.md` 面向“调研、解释、审计、部署或扩展 dsh-superagent prototype”的 DSH 会话。它要求：

- 先加载 `knowledge-base/README.md`，按问题选择 architecture/operations/source-index/evidence；
- 固定 commit 与 DSH 版本，区分代码存在、profile 挂载和运行观测；
- 研究/配置前采用 SETUP 的 probe → 逐问 → 一次 plan confirmation → operator 手动 secrets → execute → status/trace 验证；
- 所有网络、凭据、full-access、auto/merge 和 API 操作写清失败边界；
- 默认只读，不执行上游文档中的副作用命令；用户明确授权后仍需最小范围、可回滚、真实证据；
- 未实测项目必须写“未验证”，不把 fake/fixture/unit test 当生产联调。

## 5. Skill 使用边界

Skill 是可复用指令和 references，不是执行器，也不会自动安装 bundle、登录 GitHub/Feishu、切换 profile 或授予网络/文件权限。要实际启用它，还需把 Skill 目录安装到目标 DSH workspace 的发现路径，并以真实 profile/运行 trace 验证。

## 6. 输出模板

回答该项目问题时按以下结构：

1. **结论**：适用 upstream commit、DSH 版本、用途和状态；
2. **证据**：上游 path + symbol/line；必要时给 GitHub URL/commit；
3. **流程**：Source→Trigger→Eval→Ticket→Executor→Channel 或部署步骤；
4. **失败边界**：权限、凭据、网络、重试、恢复、full-access、版本迁移；
5. **验证方法**：真实命令/HTTP/API/trace，附 exit code；
6. **未验证项**：明确静态证据不能替代的运行事实。
