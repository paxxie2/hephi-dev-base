# B7 准备矩阵数据说明

状态：pending-prereg。仅维度准备，不是正式实验，也不是真实端到端验收。hephi 的离线安装与完整 `pnpm check` 已于 2026-11-08 在干净克隆上真实通过；site-pnl-diagnosis 检查因 DB/seed 环境前置失败；dubbo 未验证。

## 仓库依据

| 仓库 | 本地材料与固定提交 | 当前限制 |
|---|---|---|
| hephi | main `2eb05b1a0461023e6472fa7e19fe7c7e7adad3f5`，干净克隆 `/tmp/b7-hephi` | **已验证**：`pnpm install --frozen-lockfile --offline` exit 0；`pnpm check` exit 0（39 files / 545 tests / build 1394ms）；仍是本机构建，不是宿主运行验收 |
| site-pnl-diagnosis | base `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`，干净克隆 `/tmp/b2b7-site` | **失败**：`npm --prefix web ci --offline` exit 0，但 `bash scripts/check.sh` exit 2（pytest collection errors: backend/tests/test_db.py、test_seed.py，DB/seed 环境前置缺失）→ environment/checks 未就绪 |
| dubbo | `/Users/zm/workspace/app/dubbo`，`42bd630514371db37b09afb36dae7190a82662d6` | `docs/p10-offline-build.md` 仅历史证据；本轮未构建、未访问宿主 |

当前 `environmentReady/offlineBuild/checksConfig`：hephi=true（已真实验证）；site-pnl-diagnosis=false（检查失败）；dubbo=false（未验证）。false 表示未核验/未通过，不表示确定不可用。禁止把夹具正反向验证提升为整仓就绪，也不得把本机构建写成宿主验收。

## 模型依据

`gpt-6-astra` / openai 与 `deepseek-flash` / deepseek 是本轮工具目录明确存在的模型名。仅为待批准候选；没有读取宿主配置、调用模型或测可用性。候选不等于已注册实验组，不锁参数和样本量。

## 生成和验收

```sh
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --dry-run
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --out eval/b7-matrix.snapshot.json
```

组合数由生成器计算，snapshot 是准备快照；`preregLocked=false`，所有组合 `sampleSizeStatus=pending-prereg`。2026-11-08 以真实构建更新后的矩阵为 **6 组合 / eligible=2**（hephi × 两个候选模型），其余 4 组合 blocked（site-pnl check 失败、dubbo 未验证）；仍有 4 组合不可运行。**eligible≠正式实验就绪**：无 PREREG 锁定、无样本量、无模型调用，不能据此启动 B7 或声称泛化收益。快照时间会随重生成变化。
