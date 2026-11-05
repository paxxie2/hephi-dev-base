> 历史记录：针对删减前的 45b2a4a/a10d96f，不代表当前实现。当前范围见 docs/validation/ready-evidence-lean.md。

# 主助手实施中只读审查记录（待 Worker 处理）

以下来自当前未提交实现，不表示最终缺陷清单；不要扩大范围，只修这些与已批准语义直接相关的缺口。

1. src/verification/check-evaluate.ts pass分支检查 failures，但没有统一拒绝 errors；targetTests为空时所有skipped也可能通过。验收：JUnit errors>0即不通过；必需测试集合不能全部skip；MVP未定义可选skip时保守拒绝skip。添加对应测试。
2. reproduce目前只用environmentalFailure黑名单排除已知错误，没有证明是预先指定的业务断言。未知RuntimeError等仍可通过；failureMessage使用attribute(message)优先丢弃body，body中ModuleNotFoundError可能漏检。应同时保留message与body，先拒绝运行异常，再要求明确目标断言类型及合同约定（例如固定failure type/message匹配），无法证明就blocked。不能仅靠“不是已知坏错误”即passed。
3. 新verification合同不应仍强制HEPHI_TEST_COMMAND和HEPHI_REVERSE_TEST_COMMAND；新功能无需reverse也应可prepare。仅对旧格式保留原始字段与原hash，不用伪命令填空。新合同checks负责完整验收配置。
4. parser=exit不能被用于宣称业务测试通过；配置需明确build/command与test用途并校验。purpose自由文本本身无法执行这个区别。
5. 记录结构需保存执行器真实构建身份（不是固定版本描述字符串）并在ready核查支持版本。只记录shell路径不能证明代码版本。

这些均为已批准MVP的实现细节约束，不增加CI/影响分析/签名等能力。

## 第二轮：原生后台执行与证据身份

6. native-bash.ts 在 tools.execute 返回后 finally 清掉总超时并解绑 outer abort，promoted Job 因而不再受合同剩余超时及取消控制；settleJob 又写死 wait 30000，一次返回 running 就 kill。应保持整个执行生命周期的 deadline/abort，按剩余时间循环等待，直到真正终态或合同超时；覆盖 >30秒但未超时、promoted后取消、超时确认终止、终止不确定保持关闭测试。
7. runCheck 的 native 注入是测试 seam，但证据未标记 fixture/diagnostic 来源，不能被 ready 作为生产证据接纳；请将非原生执行 seam 结果显式标记不可交付，并由 ready 拒绝。聚焦测试需要分别断言拒绝与真实入口工具接线行为，不用测试注入生成生产 passed。
8. evidence-verifier 必须核对 record.ticketId == contract.ticketId、原生外层调用/Session 标识存在及 executor build 格式有效；不要只信目录位置。保留原始身份以便审计。
9. check-control 目前只查直接子 Agent；请明确递归检查活动后代，以及已存在父 Session 后台 Job 的边界。预览服务不能一律阻塞；无法识别写入 Job 时必须在交付说明写明该限制，不能宣称绝对并发隔离，不能为此新增调度器。

10. executor-identity.ts 当前在每次检查时读取磁盘 modulePath，不能证明宿主已加载的执行代码版本；磁盘构建更新但内存旧代码时会冒认新版本。请在模块加载时固定身份，记录当时摘要；至少 bundle 部署路径需覆盖真实执行 bundle，源码测试环境不能把单个 identity.ts 摘要声称为整个执行器摘要。ready 不要把“旧内存读取新磁盘”当新版本执行证据。增加磁盘替换后身份不跟着变、证据拒绝的聚焦回归，明确非部署实测。

11. check-control 的 unconfirmed fault 仅在内存，提示 remount 即可恢复会不安全。若无法确认检查进程终止，使用现有run记录持久化该事实；重新挂载后不得仅新建一个run盖过它。用原生job身份核实终态，找不到/仍未知则拒绝新检查及ready，明确人工处置；这不要求新增状态机。普通的结果丢失且进程确认终态可以重跑。请覆盖重新挂载/旧run未知场景。

## 返修后核对（需在最终测试前处理）
12. executor-identity.ts 的 capture 对 bundle 也使用manifestHash(modules)，但 verify bundle用sha256(readFileSync(modulePath))，两者必不相等，真实构建部署会全拒绝。请统一并增加真实构建产物加载/检查的聚焦集成（可隔离临时宿主，不碰运行中DSH；不能只在TS源码下通过）。同一测试要覆盖执行模块磁盘替换后的拒绝。
13. check-runner 开始时生成innerCallId，但 executeNativeBash内部另生成一个；记录必须更新为实际 outcome.innerCallId，或只生成一次传入，不能留下并未执行的ID。验证正常路径记录与tools.execute参数一致。
14. 同第11条，重启时遗留的 status=running 可能尚未来得及写 fault。不能只筛 record.fault；未知 running 不能用下一次成功覆盖。至少检查入口和ready把所有未确认终态run拒绝，并用真实Job确认后才允许重试。原生公开API若无法找回，明确人工处置，不假设已结束。请确保文档不承诺 remount 就能解除未知进程；当前INTERNAL_FAULT文字要改正。
