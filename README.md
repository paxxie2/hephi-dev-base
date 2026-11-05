# Super Agent + HEPHI 源码审查资料

供其他模型和人工审查使用的公开源码快照。不是新的执行器、不是运行实例，也不是原项目迁移。原项目的 Git remote 未修改。

## 固定版本

| 项目 | 分支 | 提交 |
| --- | --- | --- |
| HEPHI | main | `8e68ec27ef6cc3e16991bc56c841e2f0ac7f2db5` |
| Super Agent | codex/multi-repository-github | `62d7d53723e5841eca5e02b151c1b48653650ea4` |

来源为 2026-11-05 整理的干净工作区快照。不是当前宿主运行版本证明。源码中的本机 `/Users/zm` 已替换成 `/Users/USER`；逐文件原始与发布哈希及修改名单见 PUBLICATION-MANIFEST.json。部署路径必须自行配置。

## 资料导航

- [HEPHI 源码与文档](projects/hephi/README.md)：合同、KB、native/staged、检查与 ready。
- [Super Agent 源码与文档](projects/super-agent/README.md)：来源、Ticket、Worker、授权和交付。
- [Super Agent 源码索引](projects/super-agent/knowledge-base/source-index.md)
- [Super Agent 本地变更](versions/super-agent-local-changes.patch)：6337fc8 至快照 HEAD，不含 lockfile 差异。
- [版本记录](versions/projects.json)；同目录包含最近提交列表。
- [历史串行小任务摘要](evidence-summary/issue-22-historical-result.md)：仅历史摘要，未公开原始会话和运行日志，不能单凭摘要独立确认通过。

每个项目保留 src、tests、scripts、skills/prompts、配置样例、依赖锁文件与项目内文档。未上传 node_modules、lib 构建产物、.git 原历史、实际 profile、凭据、运行数据库、完整 Session、浏览器截图或原始实验轨迹。原始日志 .log/.exit 不公开，因此历史文档中部分相对链接可能缺失。

## 先注意文档与实现的差异

1. Super Agent knowledge-base 的基线为 `6337fc8`（2026-10-31），不是当前快照 `62d7d53`，仅作导航。
2. HEPHI README 的“只接受前台检查”描述已落后：`8e68ec2` 的 check-runner 已增加原生后台 Job 等待。请以当前源码为准。
3. HEPHI docs 保留旧设计及历史结果，涉及 XML/reverse/旧适配器的描述可能已经失效，不代表当前运行逻辑。
4. Issue #22 实验发生在后台修复提交之前，记录为648d798加工作区修改，后来提交为8e68ec2；本公开包不提供完整原始证据，不能将摘要当当前版本新验收。
5. 原生 #18 链路曾通过但扩展业务黑盒有两项失败；串行 #19 曾被用户判定超时失败。不是所有历史任务都成功。
6. 本次仅整理发布，未新跑测试或端到端验收，不宣称完整业务正确性。

## 建议审查顺序

HEPHI：`src/index.ts` → `control/activation.ts` → `worker-mount.ts` → `check-runner.ts`/`check-store.ts` → `ready-gate.ts`/`verification/` → `stage-control.ts`/`stage-mount.ts`/`stage-process.ts` → Skill 与测试。

Super Agent：`knowledge-base/source-index.md` → 当前 `src/app/sessions.ts`、`src/app/tools/executor.ts`、`src/executor/dsh.ts`、`src/executor/background.ts` → `prompts/` 与 tests。

## 可直接给审查模型的要求

先核对版本与源码，不仅阅读总结。检查 native/staged 是否独立可选、阶段检查/checkpoint/progress 是否闭合、后台执行/超时/取消/重试是否正确、ready证据与范围/HEAD/PR是否一致，以及跨项目是否仍有硬编码。区分“命令执行成功”和“业务验收正确”。

每项发现给出文件/行号、触发条件、实际影响和最小修复；区分静态推断、聚焦测试、真实端到端证据。目标是减少代码与维护成本，不新增框架、执行器、兼容层或大规模重构。资料供审查，不授权改动原运行环境。

## 版权

Super Agent 来源包含 `deepseek-ai/dsh-superagent-prototype` 及本地修改，保留其 [MIT LICENSE](projects/super-agent/LICENSE)。其余文件保留各自已有声明；本资料仓库不额外赋予第三方代码许可，也不表示官方背书。
