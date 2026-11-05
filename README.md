# HEPHI 插件有效性评估与改造

本仓库评估并改造 Super Agent 的赫菲（HEPHI）插件，目标是提升大模型交付需求的稳定性，减少目标漂移、范围随意修改和随意重构。

- [`REPORT.md`](REPORT.md)：改造前的评估（40 分）以及依据。
- [`PLAN.md`](PLAN.md)：第一版改造方案。其中部分设计已按 [Issue #1](https://github.com/paxxie2/super-agent-hephi-review/issues/1) 撤回，文中的 84 分和 90～92 分不是实测结论（见文件开头的修订说明）。
- [`ROADMAP-95.md`](ROADMAP-95.md)：从当前的 55 分到 95 分的落地方案，包括分阶段工作包、实验协议、门槛和分工。
- [`ROADMAP-95-PREREQUISITES.md`](ROADMAP-95-PREREQUISITES.md)：实施上述方案之前必须具备的前置条件、两个继续与否的关口和总出口清单。
- [`hephi/`](hephi/)：改造后的插件。第一个相关提交是快照 `8e68ec2` 的原样导入，之后的提交就是全部改动。
- [`eval/ab-metrics.mjs`](eval/ab-metrics.mjs)：开、关赫菲对照实验的指标计算脚本。其中的“无关重构”仍按格式化和重命名估算，待按 `ROADMAP-95.md` 的 WP0.2 改为盲评标签。
- [`probes/`](probes/)：改造前用于证明缺口的探针测试，需放进原始快照中运行（见 `REPORT.md` 第 8 节）。

## 运行

需要 Node.js 22.19 或更高版本，以及 pnpm。

```bash
cd hephi
pnpm install --frozen-lockfile
pnpm check        # 类型检查、140 个测试、构建
```

对照实验：

```bash
node eval/ab-metrics.mjs runs.json
```

`runs.json` 的格式写在脚本开头的注释里。
