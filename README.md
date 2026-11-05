# HEPHI 插件有效性评估与改造

本仓库评估并改造 Super Agent 的赫菲（HEPHI）插件，目标是提升大模型交付需求的稳定性，减少目标漂移、范围随意修改和随意重构。

- [`REPORT.md`](REPORT.md)：改造前的评估（40 分）以及依据。
- [`PLAN.md`](PLAN.md)：改造方案、实现说明、重新评分（现在 84 分，宿主核对并完成对照实验后 90～92 分）、落地步骤和残余缺口。
- [`hephi/`](hephi/)：改造后的插件。第一个相关提交是快照 `8e68ec2` 的原样导入，之后的提交就是全部改动。
- [`eval/ab-metrics.mjs`](eval/ab-metrics.mjs)：开、关赫菲对照实验的指标计算与判定脚本。
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
