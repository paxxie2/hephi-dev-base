# B7 环境补全证据（2026-11-08）

本目录保存 B7 环境矩阵补全时**实际执行**的命令日志（原始 stdout/stderr + 退出码行）。
日志来自本机（macOS arm64，Node v26.1.0，无宿主实验），只用于环境准备，不是 B7 实验结论。

## 仓库与工作副本

| 仓库 | 工作副本 | 提交 | 说明 |
| --- | --- | --- | --- |
| site-pnl-diagnosis | `/tmp/b7-site2`（clean clone，源 `/Users/zm/dsh-instances/experiment/sources/site-pnl-diagnosis`） | 验证提交 `ab7c8e03b6938df9fc52d486477402db313ae1ca`（PR#29 恢复 data 源码）；默认 HEAD `1e166fbe...` 失败 | 未修改仓库文件；`.venv`/`web/node_modules`/`web/dist` 为安装/构建产物 |
| dubbo | `/tmp/b7-dubbo`（clean clone，源 `/Users/zm/workspace/app/dubbo`） | `42bd630514371db37b09afb36dae7190a82662d6` | 未修改仓库文件；离线 Maven 构建 |

## 文件与命令

| 文件 | 命令 | 结果 |
| --- | --- | --- |
| `toolchain-versions.log` | `node/npm/uv/python3/java/mvn` 版本、`~/.m2` 大小 | 记录环境 |
| `site-base-check.log` | 在默认 HEAD `1e166fb` 上 `uv sync; bash scripts/check.sh` | **exit 2**：pytest collection error `ModuleNotFoundError: No module named 'app.data'` |
| `site-root-cause.log` | `git show 1e166fb:.gitignore`、`git ls-tree ... backend/app/data`、`git show --stat ab7c8e0` | 根因：默认 HEAD 的 `.gitignore` 用 `data/` 忽略了 `backend/app/data/`，源码未入库；PR#29 `ab7c8e0` 恢复 3 个 data 文件 |
| `site-restore-check.log` | 在 `ab7c8e0` 上 `uv sync; npm --prefix web ci --offline; bash scripts/check.sh` | **exit 0**（pytest 通过、vitest 59 passed、typecheck/build OK、`全部检查通过`） |
| `site-offline-uv-sync.log` | `uv sync --offline`（先删除 `.venv`） | exit 0 |
| `site-offline-npm-ci.log` | `npm --prefix web ci --offline --no-audit --no-fund`（先删除 `web/node_modules`） | exit 0，175 packages |
| `site-offline-check.log` | 上述离线安装后 `bash scripts/check.sh` | **exit 0** |
| `site-checks-config-command.log` | 平台项目检查配置的原始命令 `sh -c 'npm --prefix web ci --no-audit --no-fund && bash scripts/check.sh'` | **exit 0** |
| `dubbo-offline-compile.log` | 全仓 `mvn -o -B -DskipTests -Dmaven.javadoc.skip=true -Dcheckstyle.skip=true -Drat.skip=true -Dmaven.source.skip=true compile`（JAVA_HOME=openjdk@17） | **exit 1**：`org.jboss.netty:netty:3.2.10.Final` 不在本地 `~/.m2`，离线模式禁止下载（构建约到 `dubbo-remoting-netty` 失败） |
| `dubbo-p10-compile.log` | `docs/p10-offline-build.md` §2 命令：`mvn -o -B -pl dubbo-common -am -DskipTests ... compile` | **exit 0**，BUILD SUCCESS 3.591s |
| `dubbo-p10-test.log` | `docs/p10-offline-build.md` §3 命令：`mvn -o -B -pl dubbo-common -Dtest=StringUtilsTest -DfailIfNoTests=false test` | **exit 0**，Tests run: 37, Failures: 0, Errors: 0 |

## 未覆盖 / 限制

- site-pnl：默认分支 HEAD `1e166fb`（也是 B2 任务 base）**不能**通过 `scripts/check.sh`，因为它缺少
  PR#29 才恢复的 `backend/app/data` 源码；本目录的通过结果是 `ab7c8e0`（含恢复提交）上的真实结果。
  在把 PR#29 合入 B2 任务 base 之前，不得把 site-pnl 的检查配置当作可在任务 base 直接运行。
- dubbo：离线构建只验证了 `dubbo-common` 作用域（P10 文档范围）；全仓离线编译因缺
  `org.jboss.netty:netty:3.2.10.Final` 失败，未回退在线下载。`experiment/project-config/` 没有
  `dubbo-checks.json`，本目录不修改宿主侧配置。
- 全部结果仅为本机构建/检查，不访问宿主、不运行任何 B5/B7 实验、不锁定 PREREG、不产生样本量。
