# MVP 删除与真实交付验收

运行代码：`e8bd69f`，分支 `codex/ready-evidence-mvp`。
项目仍在 `/Users/USER/Documents/ChatGPT/现代软件开发/hephi-superagent-plugin`；没有创建新的项目或运行架构。

## 已删除的实现

相对 `31e0236`：63 个文件变化，新增 198 行、删除 2716 行，净减少 2518 行。

- 旧 Delivery、手动交付工具、旧合同模型和重复证据存储。
- Dubbo 专用 ready 验证器、Recipe。
- XML parser、旧 runner、反向验证分支及报告字段。
- Dubbo、Topic Bench、Python 项目的报告转换脚本。
- prepare 中的项目名单、个人工作区路径和项目默认命令。
- 经用户单独批准，清理 Skill 中相应旧指令；native/staged 选择及权限不变。

保留：prepare 合同、KB、项目原生检查、真实结果与日志、Git 指纹、PR 核验；显式 staged 任务保留既有串行检查/checkpoint/progress。普通 native 任务没有阶段记录。

## 自动检查

`pnpm check` 实际通过：类型检查、11 个测试文件 / 109 项测试、构建。测试中含本地真实 Git/命令进程测试，也含明确标注的宿主结果 fixture；这些不单独充当原生端到端证据。`git diff --check` 通过。

## 原生端到端

环境：既有实验 DSH rc.5，API `http://127.0.0.1:56892/orchestrator/api/`，PID 7017。重载前 API 确认 running=0、queued=0。桌面 DSH 未重启，Super Agent 源码未修改。

通过 GitHub 创建新 Issue，原生 Router 创建 Ticket、prepare 生成合同及 intent，Worker 读取 Skill/合同、查询 KB、实现和执行检查、创建 PR、报告 ready。没有预写合同、修改证据、代写 Worker 业务代码或合并 PR。

| 模式 | Issue | Ticket | PR | 本地/PR/检查 HEAD |
|---|---|---|---|---|
| native | #16 | 1e2b6bd193b93f948e7a0cc3156422a5 | #19 | 0074ab7262b45bd8f952537f15af11be4eac9cbe |
| staged | #17 | bb21e02a32845a0caa9cc9e4c4d8f009 | #18 | b3b9578cc528ffc06139c67ff508e84f8bef743e |

仓库：`paxxie2/topic-bench-forced-stages-20261103`。两条 PR 均 OPEN、base=main；工作区 clean。每个任务的 syntax、http-regression 都真实执行，原生 Session 的 job/registered、job/settled 与检查记录的 innerCallId/rootCallId 对应，退出码为 0。日志哈希、合同哈希和前后代码指纹核对一致；没有 XML 或 reports 目录。

两条最终 ready 均存在原始工具结果 `reported:true`，Ticket 进入 person/review，Worker turn 已结束。

### 串行过程

UTC 时间：
- A start 17:46:47.493；检查 17:47:01.104–17:47:01.282；checkpoint 17:47:01.641；成功 progress/completed 17:47:03.339。
- B start 17:47:05.607；检查 17:47:11.161–17:47:11.337；checkpoint 17:47:11.699；成功 progress/completed 17:47:13.251。

原始工具顺序与阶段记录一致。A 的 Git 提交不包含 B 的 `/api/info/features` 接口；没有委派实施子 Agent。

### 失败及复验

staged 首次 ready 查询 GitHub PR #18 时返回 EOF，工具返回错误，未放行。Worker 在同一 Ticket 内重试，后一次 ready 成功；未删除第一次失败，也未重新执行或伪造通过记录。

### 独立产品检查

独立启动两份实际提交的服务（临时空数据目录、非 seed UI），发真实 HTTP 请求：
- native：HEAD /api/health = 200、空正文；GET 仍为 `{ok:true,version:1}`。
- staged：GET /api/info 与 /api/info/features 的状态码、JSON 及功能顺序符合 Issue。

这是 API 需求的真实 HTTP 验收，不宣称做过浏览器页面用户旅程或验证整个课题台业务等价性。

## 可核查原始资料

`/Users/USER/hephi-isolated-b-20261102/ready-mvp-dual-20261105/`：
- `e8bd69f-audit.json`：合同、检查、原生执行绑定、失败/成功 ready、阶段顺序。
- `e8bd69f-http.json`：独立 HTTP 结果与提交 SHA。
- `e8bd69f-pr-18.json`、`e8bd69f-pr-19.json`：远端 PR 状态。
- `<ticket>-e8bd69f-events.jsonl`：Session 原始事件。
- `<ticket>-e8bd69f.json`：原生 Ticket 详情。

原始合同和检查日志位于实验 `state/hephi/<ticket>/`。这些是新代码的真实证据，不以旧实验成功替代。本轮复用了已有实验仓库，未宣称完全隔离所有历史。

## MVP 边界

ready 证明合同要求的项目命令在记录版本上成功，并满足交付一致性；不自动证明验收命令覆盖所有业务。项目检查入口负责对未执行目标测试、断言失败等返回失败。只有构建成功不能作为业务正确性结论。

目前只支持确定结束的前台检查；后台、取消或未知检查仍拒绝交付，异常恢复尚未实现。不保证冻结外部进程或已运行子 Agent 的瞬时写入，前后指纹不等于全程隔离。没有据这两条短任务扩展宣称任意项目、长后台检查或故障恢复已通过。

结论：精简代码下，本次 native 与 staged 两条 GitHub → Worker → 合同/检查 → PR → ready 链路及指定 HTTP 行为已真实通过；上述未覆盖能力仍不作通过声明。
