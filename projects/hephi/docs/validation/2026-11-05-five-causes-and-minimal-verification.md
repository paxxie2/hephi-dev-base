# 五项根因审查与最小删改

基线 d9c7fbf；原项目 hephi-superagent-plugin，分支 codex/ready-evidence-mvp。用户授权主助手审查并简化验证，不授权新增运行时或任意修改 Skill。核查源码、历史提交、真实 Issue #3/#4/#6/#7/#9 及 state/hephi 记录；历史证据不是本轮通过证明。

## 1. 擅自增加职责
观察：src/tools.ts 同时注册 hephi_verify、hephi_prepare_delivery、hephi_deliver，描述又要求 Worker 不要调用；新链路实际由 hephi_check 和原生 orchestrator_report 完成。旧 tools 还可走独立 OperationStore 和交付 helper。
原因：加入新入口后旧入口仍留在工具目录，靠提示词禁止误用。非 Super Agent 必须如此。
处置：从实际工具注册中删除上述三项及直接依赖。保留合同与 KB；旧源码和历史测试不冒险整库删除，其未注册/未被 ready 调用的状态写清楚。未改 Skill、Super Agent 或原生 PR 流程。
不删除：合同绑定、真实执行、终态、版本/范围/PR 核对，都是原需求的不变量。

## 2. 没有统一规则
观察：d9c7fbf 前阶段报告采用目录::suite、最终检查采用报告路径，真实 Issue #7 被误拒。d9c7fbf 已统一 pass 评估；但 ready 仍重新解析相同报告，再做一次测试语义判定。
处置：本轮 ready 不再调用 checkPass，不重新解析 XML或重跑测试；只检查最新成功记录、退出码、合同、调用身份、前后源码、必需产物与原始哈希、PR HEAD。必需报告缺失仍拒绝。执行时的可选 XML判定仍存在，不声称所有 XML缺陷修复。新原生入口不要求 XML。
边界：这不是安全隔离系统；拥有同机写权限的失控 Worker 可能改状态。不新增签名系统。

## 3. 局部测试代替链路验证
观察：146项测试通过仍出现阶段目标匹配失败。旧 stage 夹具手写具名 testsuite 和 ::target；Node reporter回归未进入 stageReports。后续新增真实Node进程→stage finish→progress测试才覆盖具体组合。
本轮验证：保留所有原有失败/成功记录；增加旧工具不暴露、glob路径、ready退出码/缺报告拒绝三个聚焦测试。150项、类型检查、构建通过不等于真实链路通过。使用 GitHub 原生 Worker 的复验另记，不凭模型总结。
不扩张：不为每个语言复制测试矩阵，不把文件行数/测试数当完成指标。

## 4. 发现问题就补机制
观察：45b2a4a 扩展了证据/恢复体系；b049c60 删除大量新增机制；后续又以局部适配修补报告。当前 running/unknown永久阻断并没有终态恢复入口，native已运行子Agent也不受主Worker检查guard约束。
判断：这些是实质缺口，不能靠“先文档声明不支持”说已解决，也不能直接删未知终态阻断或宣称前后指纹冻结全过程。本轮不重新发明后台调度/锁/递归Agent树。
后续边界：若要支持这两类场景，须复用DSH原生终态与实施活动状态；缺少可靠接口就明确不验收，不新建执行器。当前仅完成短前台检查的收敛，不能宣称所有长测试或并发验收可靠。

## 5. 准备阶段越界
观察：额外 worktree、切插件路径、反复构建重载造成运行版本混淆。MVP目录已移回原目录；旧独立worktree已删除。
约束：本轮只在原目录提交；不创建新仓库/worktree；不操作桌面；实验重载前检查没有活动Worker；不修改合同/台账假装重试成功。检查配置不再为了语言强制转XML。
附带确定修复：allowedPath以Node内置matchesGlob替代自制正则，修复**/*.ts漏根目录，并验证中文/空格/越界。

## 最小现行链路
合同冻结检查 → Worker调用hephi_check执行项目命令 → 保存终态/输出/指纹 → 原生PR → ready核验覆盖/哈希/交付一致性。
可选staged只约束A finish/checkpoint/progress后才能start B；不增加第二条PR交付链。
项目检查入口负责必需测试、失败、零测试、允许的skip；赫菲不自动理解业务覆盖。合同只build、未要求PR仍可能通过，此策略缺口未被本轮删除冗余自动解决。不能把ready称为Issue语义正确的证明。

## 本轮检查记录
pnpm check：21文件、150测试通过，typecheck和build通过。产品3文件9增71删（以最终git diff为准）；无新增产品组件。工具bundle从20.06kB降至14.73kB；这不是延迟或模型费用改善的实测。
真实端到端结果将在当前提交原生任务完成后追加；此前d9c7fbf的PR#10/#11仅为历史。

## 当前提交 d580188 的真实复验

- native：GitHub Issue #12 → Ticket dfba1ba9ee95f480d5654562cb7e772a → 原生 Worker/prepare → 两项 hephi_check → ready真实返回reported=true → 未合并PR #14。HEAD 513af1e335574504cec127ecb999af234dfaf943。
- staged：GitHub Issue #13 → Ticket 038ba29933ca5855fe1d69d771b2cad5 → 原生 Worker/prepare → A finish/checkpoint/progress完成后才start B → B finish/checkpoint/progress → 累计hephi_check → ready真实返回reported=true → 未合并PR #15。HEAD 42872eb04fc7088c081011a40da879cd679b70c4。
- 两者最终检查都走固定Node原生入口，无XML报告；阶段A/B使用node --test实际检查。没有旧工具调用。
- 独立核对两者源码工作区clean、检查before/after指纹与PR HEAD一致、原始日志哈希、ready工具结果；独立启动实际HTTP服务确认HEAD health空正文及GET不变、info/features精确响应。验收服务已停止。
- 证据：/Users/USER/hephi-isolated-b-20261102/ready-mvp-dual-20261105/d580188-audit.json、d580188-http.json、两个Ticket的*-events.jsonl与state/hephi记录。
- 这证明本次删减后的两个短Node任务真实触发/执行/验证/交付通过，不证明Go/PHP、长后台测试、native并发验证或恶意篡改防护。历史失败未删除；不是历史隔离性能对比。
- 三个实际产品文件9增71删，净减62行；新增三个针对性测试，未删除原有保护测试。
