# B7 准备矩阵数据说明

状态：pending-prereg。仅维度准备，不是正式实验，也不是真实端到端验收。
2026-11-08 已完成一次真实环境补全：hephi 离线安装与完整 `pnpm check` 通过；site-pnl-diagnosis 在
恢复 data 源码的提交上 `bash scripts/check.sh` 与平台检查配置命令均 exit 0；dubbo 在干净克隆上
P10 文档的离线编译 + 离线测试命令通过（全仓离线编译仍失败，见下）。

> 重要限制：site-pnl 默认分支 HEAD `1e166fbe...`（也是 B2 任务 base）**仍然失败**，因为它缺少
> PR#29 才恢复的 `backend/app/data` 源码。本文件的 site-pnl=true 只表示“该仓库在含 data 恢复提交的
> 干净检出上环境/检查可用”，**不等于** B2 任务 base 现在可以直接跑检查。矩阵 `eligible` 只表示
> 环境与检查配置就绪，不是任务有效性或实验就绪。

## 仓库依据

| 仓库 | 本地材料与固定提交 | 本轮真实验证 |
|---|---|---|
| hephi | main `2eb05b1a0461023e6472fa7e19fe7c7e7adad3f5`，干净克隆 `/tmp/b7-hephi` | **已验证**：`pnpm install --frozen-lockfile --offline` exit 0；`pnpm check` exit 0（39 files / 545 tests / build 1394ms）；仍是本机构建，不是宿主运行验收 |
| site-pnl-diagnosis | 干净克隆 `/tmp/b7-site2`；默认 HEAD `1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`；验证提交 `ab7c8e03b6938df9fc52d486477402db313ae1ca`（PR#29 恢复 data 源码） | **已验证（限该提交）**：`uv sync --offline` exit 0；`npm --prefix web ci --offline --no-audit --no-fund` exit 0；`bash scripts/check.sh` exit 0（pytest 通过、vitest 59 passed、typecheck/build OK）；平台检查配置命令 `npm --prefix web ci --no-audit --no-fund && bash scripts/check.sh` exit 0。**默认 HEAD 上同一命令 exit 2**：`ModuleNotFoundError: No module named 'app.data'`（`.gitignore` 的 `data/` 曾把 `backend/app/data/` 忽略，PR#29 才恢复并改为 `/data/`） |
| dubbo | 干净克隆 `/tmp/b7-dubbo`，`42bd630514371db37b09afb36dae7190a82662d6`，`JAVA_HOME=openjdk@17`，Maven 3.9.9，`~/.m2` 5.4G | **部分已验证**：P10 文档命令 `mvn -o -B -pl dubbo-common -am -DskipTests ... compile` exit 0（BUILD SUCCESS 3.591s）；`mvn -o -B -pl dubbo-common -Dtest=StringUtilsTest test` exit 0（37 tests, 0 failures）。**全仓** `mvn -o ... compile` exit 1：`org.jboss.netty:netty:3.2.10.Final` 不在本地 `~/.m2`，离线模式不回退下载 |

当前 `environmentReady/offlineBuild/checksConfig`：

| repo | environmentReady | offlineBuild | checksConfig | 说明 |
|---|---|---|---|---|
| hephi | true | true | true | 已真实验证（离线安装 + 完整检查） |
| site-pnl-diagnosis | true | true | true | 仅在含 data 恢复提交 `ab7c8e0` 的干净检出上真实验证；默认 HEAD 失败，B2 task base 需先合入 data 恢复 |
| dubbo | true | true | **false** | 离线构建只验证 `dubbo-common` 作用域；`experiment/project-config/` 无 `dubbo-checks.json`，本目录不修改宿主配置 |

false 表示未核验/未通过，不表示确定不可用。禁止把夹具正反向验证提升为整仓就绪，也不得把本机构建写成宿主验收。

## 模型依据

`gpt-6-astra` / openai 与 `deepseek-flash` / deepseek 是本轮工具目录明确存在的模型名。仅为待批准候选；
没有读取宿主配置、调用模型或测可用性。候选不等于已注册实验组，不锁参数和样本量。

## 证据

- 日志目录：`eval/evidence/b7env/`，逐条命令、退出码、失败原因见该目录 `README.md`；校验：`shasum -a 256 -c eval/evidence/b7env/SHA256SUMS`。
- 关键日志：`site-base-check.log`（默认 HEAD 失败）、`site-root-cause.log`（缺失 data 源码的根因）、
  `site-offline-check.log`（离线安装后 check.sh exit 0）、`site-checks-config-command.log`（平台检查命令 exit 0）、
  `dubbo-p10-compile.log` / `dubbo-p10-test.log`（P10 命令 exit 0）、`dubbo-offline-compile.log`（全仓离线失败原因）。

## 生成和验收

```sh
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --dry-run
node eval/b7-matrix.mjs --repos eval/b7-data.json --models eval/b7-models.json --out eval/b7-matrix.snapshot.json
```

组合数由生成器计算，snapshot 是准备快照；`preregLocked=false`，所有组合 `sampleSizeStatus=pending-prereg`。
2026-11-08 以真实环境验证更新的矩阵为 **6 组合 / eligible=4**（hephi×2 + site-pnl×2），dubbo×2 因
`checks-config-not-ready` blocked。**eligible≠正式实验就绪**：无 PREREG 锁定、无样本量、无模型调用；
site-pnl 的 eligible 还受“B2 task base 缺少 data 恢复提交”这一前置限制。不能据此启动 B7 或声称泛化收益。

## 未验证 / 待办

1. site-pnl：把 PR#29（`ab7c8e0`，恢复 `backend/app/data` 并将 `.gitignore` 改为 `/data/`）合入 B2 任务
   base `1e166fb`，否则任务 worktree 上检查仍会失败；本轮不修改 site-pnl 仓库、不做合并。
2. dubbo：全仓离线编译缺 `org.jboss.netty:netty:3.2.10.Final`；如 B7 需要全仓构建，须先在**离线前**
   预热该依赖到 `~/.m2`（本轮未联网补齐，避免把在线下载伪装成离线能力）。
3. dubbo 检查配置：需要负责人决定是否新增 `experiment/project-config/dubbo-checks.json` 并接入宿主；
   本目录只改 `eval/**`，未动宿主/实验实例。
4. PREREG 仍为 pending-prereg：D-4 样本量、D-7 仓库范围等未批准；无 PREREG 锁定、无正式运行、无独立复现。
5. 所有验证均为本机构建/检查，不是实验宿主 B 的端到端验收。
