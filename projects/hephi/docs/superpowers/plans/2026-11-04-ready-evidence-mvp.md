> 历史记录：针对删减前的 45b2a4a/a10d96f，不代表当前实现。当前范围见 docs/validation/ready-evidence-lean.md。

# Ready evidence MVP implementation plan

执行：由本地 DSH DeepSeek 实现、自测和 Git 提交；主助手指挥和独立验收。不是 Super Agent 业务任务端到端证据。
基线：7bd6fe0；隔离分支 codex/ready-evidence-mvp。用户已批准本轮 MVP，禁止扩展 CI、影响分析、签名、任务树、调度器或独立运行时。

## 目标和边界
项目检查可配置；合同实施前冻结必需验收；Worker 主动执行具名检查；原生 DSH 执行结果绑定代码版本；ready 只核验结果。保留 native/staged 的调度及串行语义、KB、PR、scope 和合同绑定。
不触碰主工作区 lib、桌面配置、运行实例、现有 Ticket 合同、业务源码、远程仓库。不得重启、部署、创建/合并 Issue/PR。
所有实现前先核实 DSH 公共接口。无原生执行/终态接口时报告阻塞，不用自己另造子进程运行时代替。旧合同的原哈希保持可读，缺新检查配置时明确需要新合同，不静默绕过或回退旧宽松结论。

## 1. 接口核实（DeepSeek 只读，主助手确定接线后才实施）
核对 agent-scoped 工具可见性（复用 hephi_stage 注册路径）、DSH 原生命令执行、Job wait/终态、输出保留、工具调用 ID、stage guard。输出文件行号与类型；不猜API。

## 2. 固定数据约定
- 在 activation 合同增加可选 verification 字段，版本 1。原字段原哈希校验后读取；新任务走新字段。
- verification.checks 为冻结数组：id、purpose（业务预期）、command、args、cwd（工作区内相对路径）、parser（exit/junit）、expect（pass/reproduce）、required、timeoutMs、reportPaths（相对本次独立报告目录）、targetTests（必要时显式case ID）、baseline（仅需前后比较时）。不由改动文件列表反推检查目标。
- 准备入口从显式项目配置读取、拷贝检查定义进合同并纳入contractHash。不为不同仓库加 if 分支。默认必需检查不能由工具调用删减；工具仅接收 checkId，身份从当前Worker读取，不接受任意Ticket/命令/verdict。
- baseline/预期复现必须在合同固定；首版不能可靠判别的失败原因标 unknown，不把任意 failures>0 当成功。
- 项目配置可供用户批准的新合同使用；不修改既有激活合同。增加 Dubbo、Python 示例配置（说明必须按真实项目确认命令与目标，不冒充实际部署）。

## 3. 通用检查与证据
新增 hephi_check(checkId)，在当前Worker scoped注册（与hephi_stage同模式）；使用经核实原生执行接口。
runId 随机唯一；stateDir/hephi/ticket/checks/runId 保存原子执行记录。开始前持久化running并绑定 ticketId、contractHash、checkId、冻结check配置hash、sessionId、headSha、patchHash、source changedFiles、执行器构建身份、真实argv/cwd/开始时间。只接受clean且合同remote/base/scope合格工作区。
完成后记录原生调用/Job ID、最终退出/取消/超时、结束时间、前后指纹、报告与必要日志哈希、测试计数与实际case结果。可稳定读的原生记录仅引用；临时报告必须快照。保留每次失败，不覆盖。
并行实施期间不得形成有效验收：检查自己开始前核对原生活跃子agent和相关任务；检查期间主Worker新实施入口关闭，检查结束解除。不扩大成新的阶段锁或影响普通任务；无法识别安全的后台任务时明确阻塞原因，不能无条件要求预览服务器退出。若无法在现有接口下满足这一点，停止并报告。
首版不缓存跨版本结果；HEAD/patch变化旧记录失效。重启遗留running、丢失结果、缺报告/报告损坏、dry-run均不能通过；允许同check重新执行生成新run。不信任Worker自填passed。
报告解析：build可exit；测试必须真实报告有执行的目标case，缺失/零/skip/解析失败不能通过。XML解析验证完整结构与合法计数，拒绝仅靠regex汇总导致的错误归类；新依赖仅限确需的轻量XML解析库，否则报告。
reproduce要求预先指定目标case的预期业务断言，不接受ModuleNotFoundError/编译/导入/环境失败；MVP若不能可靠识别指定判据就blocked，禁止自动放宽。日志/报告并不证明所有业务覆盖，报告中说明。

## 4. ready纯核验
抽取/复用现有合同/KB/workspace/remote/base/clean/scope/PR/fingerprint检查；新ready只读取每个required check最新有效执行结果（不能越过后续失败选更早成功），重算产物hash、当前指纹与合同绑定，核实终态、目标/结果。任何缺项拒绝并列出checkId和原因；不重复执行项目测试、不自动上报blocked。
修git路径为-z NUL读取，保留Unicode/空白，不trim每条路径。
legacy verifier 保留源码仅供兼容诊断，不作为新ready失败后第二裁判；旧合同给出明确重新准备指引而非损坏启动。不得自动改现有任务。

## 5. 接线与文档
src/control/activation.ts、worker-mount.ts、index.ts、verification/fingerprint.ts、parser.ts及新增最少check模块。stage-mount/control只允许为hephi_check进入最终验收增加精确接线，不改变plan/start/finish/progress、委派禁令或native行为。检查工具不允许在未完成阶段时绕过阶段；阶段结束可执行最终检查，检查不修改源码、不创建checkpoint。
用户已批准的本方案相关启动提示/skills/hephi-superagent-control/SKILL.md只更新最终检查顺序：合同→实施→hephi_check必需项→push/PR→ready；不得改长任务选择/并行策略、无关Skill。新检查不一定要求先PR，ready仍要求PR存在且HEAD一致。

## 6. 自测与交付
每个逻辑块增加针对性测试再实现；Worker运行pnpm check与git diff --check并保存真实日志、退出码和数量。
必须覆盖：无赫菲不受影响；native/staged工具可见性；合同缺失/非法/旧hash；checkId伪造；构建成功但无测试报告；目标未跑/skip；模块缺失不能复现成功；中文路径；旧HEAD/patch/合同/产物不符；后失败覆盖前成功；检查未结束/重启不明；预览服务不被机械禁用；检查与写入互斥；ready不执行检查；同证据PR不符拒绝。
现有DSH宿主fixture只能叫接口集成，不叫真实端到端。Worker交付后主助手核查diff、日志和执行证据；发现问题退回同Worker。未经部署及新合同真实Python/Dubbo任务不可宣称MVP真实链路通过。
Git分块提交，不push、不合并。报告列SHA、文件、测试、API缺口、未验事项。

## 已核实接口与执行决定（实施接线补充）
目标 DSH rc.5 类型位于 `/Users/USER/hephi-isolated-b-20261102/node_modules/@deepseek-ai/`。全局 rc.3 不作为目标接口依据。
- `agent.ctx.tools.register` 注册 own scoped tool，不需修改 Super Agent WORK_TOOLS。
- 使用 `ctx.tools.execute` 内部调用原生 bash；传入 agent、signal、唯一callId、parent和rootCallId。命令来自冻结检查，参数使用严格shell单引号转义。
- foreground/promoted/background分别处理；有Job时使用原生wait/get/readAt拿终态，不消费模型输出游标。不调用自己的child_process执行业务检查。
- 外层hephi_check有原生Session调用记录；内部调用不保证独立Session事件，不虚构seq。记录真实外层callId、内层callId、jobId和结果哈希。
- 原生输出ring和临时spill保留不保证充分，执行完成时保存必要报告/日志快照；明确截断标志，不能声称原始输出完整。
- 阶段完成后才允许hephi_check；任何内部bash豁免只认闭包登记调用身份，不降低普通bash策略。
- 既有后台Job是否写源码无法仅从状态判断；这是需明确报告的原生能力限制，不允许悄悄将所有预览Job列为阻塞或启动全量进程隔离。

权限记录：只读核实Session不能在续接时升级成可写，未产生代码更改。实施使用新建workspace-write Session，不改宿主权限。
