# Super Agent + HEPHI 源码与升级方案

本仓库评估并改造 Super Agent 的赫菲（HEPHI）插件，目标是提升大模型交付需求的稳定性，减少目标漂移、范围随意修改和随意重构。

- [`REPORT.md`](REPORT.md)：改造前的评估（40 分）以及依据。
- [`PLAN.md`](PLAN.md)：第一版改造方案。其中部分设计已按 [Issue #1](https://github.com/paxxie2/super-agent-hephi-review/issues/1) 撤回，文中的 84 分和 90～92 分不是实测结论（见文件开头的修订说明）。
- [`ROADMAP-95.md`](ROADMAP-95.md)：评分提升路线（修订版）：统一评分表和一票否决条件（按新表初评约 26 分）、已核实的缺陷，以及能力可靠性、效果评估、能力增强三条工作线。
- [`ROADMAP-95-PREREQUISITES.md`](ROADMAP-95-PREREQUISITES.md)：实施上述路线之前必须具备的前置条件、两个关口和分组的出口清单。
- [`hephi/`](hephi/)：改造后的插件。第一个相关提交是快照 `8e68ec2` 的原样导入，之后的提交就是全部改动。
- [`eval/ab-metrics.mjs`](eval/ab-metrics.mjs)：开、关赫菲对照实验的指标计算脚本。其中的“无关重构”仍按格式化和重命名估算，待按 `ROADMAP-95.md` 的 B6 改为只提取机械指标，无关改动改由盲评判定；**B6 前不得用其估算代替效果结论**。
- [`probes/`](probes/)：改造前用于证明缺口的探针测试，固定对应原始快照 `8e68ec2`，不作为现行基线；需放进原始快照中运行（见 `REPORT.md` 第 8 节）。
- [`docs/source-consistency.md`](docs/source-consistency.md)：本地分支、隔离副本、构建与实载 commit、c547 等价修复位置的一致性表。

## 运行

需要 Node.js 22.19 或更高版本，以及 pnpm。

```bash
cd hephi
pnpm install --frozen-lockfile
pnpm check        # 类型检查、180 个测试、构建；以实际运行输出为准
```

对照实验：

```bash
node eval/ab-metrics.mjs runs.json
```

`runs.json` 的格式写在脚本开头的注释里。

## 测试分层（P6）

| 层 | 命令 | 覆盖 | 本机实测（2026-11-07，Node 26.1.0 / pnpm 10.7.0） |
| --- | --- | --- | --- |
| unit | `pnpm test:unit` | 合同/任务卡解析、激活与版本、决策日志、ready 门、工具上下文；不执行 git 或子进程 | 7 文件 / 41 tests，约 0.45s |
| integration | `pnpm test:integration` | 真实 git 仓库、子进程检查、worker 挂载、探针、eval/scripts CLI；每个用例自建临时目录，互不共享模板 | 11 文件 / 139 tests，约 34s |
| 全量 | `pnpm test` / `pnpm check` | 18 文件 / 180 tests，另含 typecheck 与构建 | 两层合计 = 全量 |

- 分层只是入口切分：`pnpm check` 仍跑全量 180 个测试，覆盖不减少。
- 环境：CI 固定 Node 22.19.0、pnpm 11.7.0（按用户决定不使用 GitHub Actions）；本机版本不同，上表耗时只作参考。
- 缓存：复用 pnpm store 与 `node_modules`；冷安装时间不计入上表。
- 并发：vitest 默认并发；同机其它构建会拉长 integration 耗时。
- **预登记性能门槛尚未定义**（P6 要求由评审确认）。在门槛登记前，不宣称任何耗时改善。

## main 分支审查入口与版本边界

本次合并保留原发布资料及 Cursor 分支的完整历史。最新方案来自 `b92c569`，最新赫菲实现来自 `a212d69`；95 分路线仍是待审方案，不代表已实施。

- **当前赫菲实现：[`hephi/`](hephi/)**。审查、安装和检查使用此目录。
- **Super Agent 源码：[`projects/super-agent/`](projects/super-agent/)**，发布快照基线为 `62d7d53723e5841eca5e02b151c1b48653650ea4`；[源码索引](projects/super-agent/knowledge-base/source-index.md) 基于较早版本，仅作导航。
- **历史赫菲快照：[`projects/hephi/`](projects/hephi/)**，版本 `8e68ec2`，仅保留作历史对照，不是当前实现。
- [原始发布清单](PUBLICATION-MANIFEST.json)、[版本资料](versions/projects.json)和[历史交付摘要](evidence-summary/issue-22-historical-result.md)只对应原始发布快照，不覆盖后来新增的 `hephi/` 和方案文档。

方案前置清单中“PR #2 尚未合并”和分支现状属于撰写时记录：PR #2 已合入评审分支，本次将修复及方案历史合入 main；其余方案内容保持原文供进一步审查。该合并没有部署插件、修改本地运行实例或执行新端到端测试，不能作为当前版本真实验收通过的证据。

源码快照中本机路径曾做脱敏替换，部署时须自行配置。未公开凭据、运行数据库和完整 Session。Super Agent 保留其 [MIT LICENSE](projects/super-agent/LICENSE)；其余文件遵循各自已有声明。
