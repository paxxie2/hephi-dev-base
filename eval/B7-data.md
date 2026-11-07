# B7 准备矩阵数据说明

状态：pending-prereg。仅维度准备，不是正式实验，也不是真实端到端验收。

## 仓库依据

| 仓库 | 本地材料与固定提交 | 当前限制 |
|---|---|---|
| hephi | 本准备分支的 Git 基线 `9fa8598f2beabe179b28733e484275c3775279d3` | 只核验局部 Node 任务夹具，不证明完整 TypeScript 构建、宿主 checks 或运行环境就绪 |
| site-pnl-diagnosis | `/Users/zm/dsh-instances/experiment/sources/site-pnl-diagnosis`，`1e166fbe2217ac378e5bb7062cd34a2da1e75e6f` | 只核验 Python 标准库任务夹具，不证明全栈离线构建、宿主 checks 或环境就绪 |
| dubbo | `/Users/zm/workspace/app/dubbo`，`42bd630514371db37b09afb36dae7190a82662d6` | `docs/p10-offline-build.md` 仅历史证据；本轮未构建、未访问宿主 |

三项 `environmentReady`、`offlineBuild`、`checksConfig` 全为 false，表示当前未核验，不表示确定不可用。禁止把夹具正反向验证提升为整仓就绪。

## 模型依据

`gpt-6-astra` / openai 与 `deepseek-flash` / deepseek 是本轮工具目录明确存在的模型名。仅为待批准候选；没有读取宿主配置、调用模型或测可用性。候选不等于已注册实验组，不锁参数和样本量。

## 生成和验收

```sh
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --dry-run
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --out eval/b7-matrix.snapshot.json
```

组合数由生成器计算，snapshot 是准备快照；`preregLocked=false`，所有组合 `sampleSizeStatus=pending-prereg`。所有组合保持 blocked，不能据此启动 B7 或声称泛化收益。快照时间会随重生成变化。
