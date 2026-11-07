# B5 off 组入口：一次性实例与真实 off run 记录

状态：**已完成 4 个 off run（真实执行）**；配对采用**回退仓库**（见 §3），配对性弱于同仓，未做效果结论。
日期：2026-11-08（Asia/Shanghai）。基线 `main=2db6c77ca153687a63edff0faaef96e680327e00`。
证据目录：`eval/evidence/b5off/`（逐文件说明见其中 `README.md`，校验见 `SHA256SUMS`）。

> 本文件只记录环境搭建与真实 off 运行；**不包含任何 B5 效果/收益结论**。off 组没有 hephi 合同、
> 检查或决策日志，验收以任务本身为准；native/off 的统计配对仍需负责人按 PREREG 口径决定。

## 1. 授权与边界

- 负责人授权：搭一次性 off profile 并试跑（2026-11-08）；授权使用 reviewer token **仅创建 off Issue**；
  允许临时 read collaborator（实际未成功，见 §3）；禁止修改宿主 B Source/配置、禁止碰 native PR、
  禁止在宿主 B 上新建 ticket。
- 未修改产品代码、未部署、未合并任何 PR；仓库侧只改 `eval/**`。
- 凭据：仅从宿主 B 的 `.credentials.yaml` 抽取两条 DeepSeek account 记录
  （`deepseek-account-platform/device`、`deepseek-account-platform/default`）到临时 profile，`0600`；
  reviewer token 只用于创建 off Issue（实际因权限未用上，见 §3）；证据/日志/仓库均不含 token 值，
  `off-host.log` 的本机 web token 已替换为 `<redacted>`。运行结束已删除临时凭据。

## 2. 一次性 off 实例（可复现）

| 项 | 值 |
| --- | --- |
| runtime | `/Users/zm/dsh-instances/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js`（与宿主 B 同安装） |
| Node | `/Users/zm/.nvm/versions/node/v26.1.0/bin/node` |
| DSH_HOME | `/tmp/hephi-off-b5`（临时；结束后删除） |
| profile | `b5off`，bundles=`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-superagent`（**无 hephi 插件/skill/tools**） |
| webserver | `127.0.0.1:3093`（不占用宿主 B 的 3083） |
| provider/model | `deepseek-account` / `deepseek-flash`（`GET /orchestrator/api/models` 返回 default） |
| stateDir | `/tmp/hephi-off-b5/state` |
| executor | directory=`/tmp/hephi-off-b5/work`，prepare=`/tmp/hephi-off-b5/prepare-off.sh` |
| GitHub Source | `paxxie2/b5-off-site-pnl`（回退仓库，见 §3），`cli=/Users/zm/.local/bin/gh-agent`，`observeIssues=true`，`allowSelfAuthoredIssues=true` |
| policy | allowed=`paxxie2`、`monsterhunterw2`；规则=默认 copy/visual + `b5-off-task`（仅本实例配置） |
| eval | `mode=auto`（仅影响主动候选；本次 Issue 显式 @ 智能体，实际以 `strength=explicit` 路由） |

启动/停止（实际执行的命令）：

```sh
# profile：从已准备的 off profile 复制并改端口/stateDir；DeepSeek 凭据只保留两条 account 记录，0600
/tmp/hephi-off-b5/start-off.sh    # nohup node bin.js --profile b5off --no-open；写 host.pid 与 logs/host.log
/tmp/hephi-off-b5/stop-off.sh     # 按 host.pid 终止并确认端口关闭
```

- 启动后 `GET /orchestrator/api/state`：`setup.problem=null`、`accounts.agent=paxxie2`、github health=ready。
- 结束核对：port 3093 LISTEN=0、off pid 不存在、宿主 B pid 74123 仍存活且 3083 仍监听。
- 清理：删除 `/tmp/hephi-off-b5/.credentials.yaml` → 删除整个 `/tmp/hephi-off-b5`；本机 `/tmp` 无残留实例。

## 3. 方案 A（同一仓库 b5-native-site-pnl）失败记录

A 方案要求用 reviewer 账号（monsterhunterw2）在 `paxxie2/b5-native-site-pnl` 创建 off Issue，
使该 Issue 不是 agent（paxxie2）自建，从而宿主 B 的 policy 可过滤。实际执行受阻：

1. 用 paxxie2 邀请 monsterhunterw2 为 **read（pull）** collaborator：`PUT /repos/paxxie2/b5-native-site-pnl/collaborators/monsterhunterw2`
   两次均 **HTTP 422** `Cannot assign monsterhunterw2 permission of read`（`-f permission=pull` 与 JSON body 两种）。
2. 复查：collaborator endpoint 404、`/invitations` 为 `[]` —— 未产生邀请，未授予任何权限，无残留。
3. reviewer token 实测只可访问 public 的 `paxxie2/super-agent-hephi-review`；对
   `b5-native-site-pnl` / `b5-off-site-pnl` / `site-pnl-diagnosis` 均 HTTP 404（无私有仓库访问）。
4. paxxie2 可访问，但它同时是宿主 B 与 off 实例的 agent 账号：它创建的 Issue 属 self-authored，
   dsh-superagent 源码要求 self-authored Issue 正文显式 @ 智能体才接收；不 @ 两个实例都忽略，
   @ 则宿主 B（policy 允许 paxxie2）会建 native ticket。无法在“同仓 + 独立 Issue + 不碰宿主 B”下安全触发。

=> 按负责人回退规则启用 **B**：`paxxie2/b5-off-site-pnl`（content copy，`b5-base=1e166fb` 与 native 同 base；
该仓库**不在**宿主 B 的 Source 监听列表，也不被 3084 实例监听 → 无双实例抢 Issue/无宿主 B 串线）。
**配对性限制**：off 仓库 ≠ native 仓库（非同仓），视为弱配对；任务文本逐字节一致（见 §4），
但仓库身份不同，跨仓可比性弱于同仓设计，报告必须保留该限制。

（此后未再尝试修改宿主 B Source；未修改 native Issue/PR；未合并任何 PR。）

## 4. 任务文本与配对对象

off Issue body = `@paxxie2 ` + `eval/tasks/site-pnl-diagnosis/previous-window-order/issue.md` 原文
（不加 `hephi-task` 合同块；该块是 native 处理组的额外校验元数据，不属于任务指令）。

- `issue.md`：sha256 `f91d1b6afb6e1d97c6132c7537afd06b548c058886248b01405e0e095b0d3497`，657 bytes。
- off body：sha256 `a54c17e945e6543ea40170c8bbc766c6dfba1571216f896db0d292fce356ed15`，666 bytes
  （与 GitHub 存储值一致）。
- native Issue #2 body：stored sha256 `47eb7002...`，1336 bytes；canonical（末尾换行）sha256
  `3fc1305d...`，1337 bytes。**off body 是 native body 的精确前缀**；差异后缀 = `hephi-task`
  合同块（670 bytes）。即：任务指令逐字节一致，差异仅为 native 处理组特有的合同块。
- off Issue 均**无 label**（无 `hephi/delivery`、无任何其他 label）。

配对映射：

| 任务轮次 | native（只读核对） | off（本次真实运行） |
| --- | --- | --- |
| run1 | Issue #2 / PR #3（draft；native ticket 曾 blocked，PR 草稿） | Issue #7 / PR #8 |
| run1-retry | Issue #4 / PR #5（OPEN，non-draft） | Issue #9 / PR #10 |
| run2 | Issue #6 / PR #8（OPEN，non-draft） | Issue #11 / PR #12 |
| run3 | Issue #7 / PR #9（OPEN，non-draft） | Issue #13 / PR #14 |

native 侧状态为 2026-11-07T23:35:54Z 只读核对（`eval/evidence/b5off/native-reference.json`）；
首轮配对建议优先使用 ready 的 3 个 native（#4/#6/#7 对应 off #9/#11/#13），run1（native #2/#3 草稿）
作为 blocked 边界样本单独记录；此混杂由负责人在分析时处理。

## 5. off run 结果（4 次全部真实完成）

| off run | Issue（无 label） | ticket id | ticket 状态 | PR | PR head | 变更文件 |
| --- | --- | --- | --- | --- | --- | --- |
| run1 | #7 `[off][B5-off] previous-window-order run1` | `a1cd12aacb7fa21db019a85f68051a37` | open / person / report=ready / strength=explicit | [#8](https://github.com/paxxie2/b5-off-site-pnl/pull/8) | `87b12ae1e9fb217a4d4cfc0a554af2afbaa0c34a` | `backend/app/domain/money.py` |
| run1-retry | #9 `... run1-retry` | `f0707370fc2fd9f7788eb6ddcd4adc0b` | 同上 | [#10](https://github.com/paxxie2/b5-off-site-pnl/pull/10) | `e301bae9c53f30d11e05cad924184d7369f09b2a` | `backend/app/domain/money.py` |
| run2 | #11 `... run2` | `86d714f089dabc6e909a878cec40eb45` | 同上 | [#12](https://github.com/paxxie2/b5-off-site-pnl/pull/12) | `9c9c664ced361a0436d5281c0abc867c816f3358` | `backend/app/domain/money.py` |
| run3 | #13 `... run3` | `10b8b5256d303017ded3187ea1c0ae11` | 同上 | [#14](https://github.com/paxxie2/b5-off-site-pnl/pull/14) | `78c44180bf946c08cc2445c29aabe16ff335f94a` | `backend/app/domain/money.py` |

- 4 个 PR 均 **OPEN**，head SHA 与对应 branch ref 完全一致（`headMatches=true`，见 `off-prs-summary.json`）；
  PR 作者 `paxxie2`，base `main`，均只改 `backend/app/domain/money.py`。
- Worker 报告（ticket `assignments[].report.state=ready`）：均自述实现了倒序窗口 `ValueError`、
  跑了本地 mirror/测试并创建 PR；PR/HEAD 已由本文件独立核对，**未**独立复核其自述测试细节。

## 6. 无赫菲证据（off 组）

- `/tmp/hephi-off-b5/state/hephi` **不存在**；`activation.json`=0、`checks/` 目录=0、`decisions.jsonl`=0。
- profile bundles 仅 `[dsh-base, dsh-web-app, dsh-superagent]`；启动脚本 `unset HEPHI_*`；进程 env 中
  `HEPHI_*` 计数=0；`host.log` 中 hephi 提及=0。
- 4 个 off Issue 无 hephi/delivery label；off 实例从未加载 hephi 插件 → 不存在合同/检查/决策记录。
- 证据：`eval/evidence/b5off/no-hephi-run1.txt`、`no-hephi-final.txt`、`isolation-snapshot.txt`。

## 7. 宿主 B 隔离核对

- 宿主 B Source 只读清单（`hostb-settings-final.json`）**不含** `paxxie2/b5-off-site-pnl`；
  off Issue 创建后宿主 B ticket 列表中**0 条**引用本 off Issue（`hostb-crosscheck.json`）。
- 注意：运行窗口内宿主 B ticket 总数从 6 → 8，新增的 2 条来自**另一条 native trial-r1 线**
  （`b5-native-site-pnl` Issues #10/#12，创建时间 23:24:16Z / 23:31:42Z），与本 off run 无关；
  这是宿主 B 的并行工作，不是本任务创建的 ticket。未修改宿主 B 的 Source/配置，未停止/修改 native PR。
- run1 创建后 2 分钟窗口内多次采样（23:16:55–23:18:46Z）宿主 B ticket 总数保持 6，new ids=[]。

## 8. 验收命令与结果

```sh
# off 实例启动/健康（实际执行）
/tmp/hephi-off-b5/start-off.sh                                  # exit 0；port 3093 LISTEN
curl -H 'x-orchestrator-request: 1' http://127.0.0.1:3093/orchestrator/api/state
                                                                # HTTP 200；setup.problem=null
# 4 个 Issue 创建
gh issue create --repo paxxie2/b5-off-site-pnl --title '[off][B5-off] previous-window-order run1' --body-file off-issue-body.md
                                                                # exit 0 -> issues #7/#9/#11/#13
# off 结果
GET /orchestrator/api/tickets                                   # HTTP 200；4 tickets 全部 person/report=ready
gh pr view 8/10/12/14 --repo paxxie2/b5-off-site-pnl            # 4 PR OPEN；headFields 与 branch ref 一致
# 清理
/tmp/hephi-off-b5/stop-off.sh                                   # exit 0；port 3093 关闭
rm /tmp/hephi-off-b5/.credentials.yaml ; rm -rf /tmp/hephi-off-b5
                                                                # 临时凭据/实例已删除
```
验收：证据齐全（本文件 + `eval/evidence/b5off/` + `SHA256SUMS`）；`git diff --check=0`；只改 `eval/**`。

## 9. 未验证 / 限制 / 清理状态

- **配对性弱**：off 使用回退仓库 `paxxie2/b5-off-site-pnl`（非同仓）；同仓方案 A 因 reviewer 账号
  无私有仓库访问、invite 422，无法安全实现。分析时必须保留该限制，不能当作同仓配对结论。
- off Issue 作者是 **paxxie2**（self-authored，需 @paxxie2 才被接收）；reviewer 账号实际未参与创建，
  也未获得任何仓库权限（collaborator/invitation 均为空，已在 §3 记录）。
- off 组没有 hephi 的合同/检查/决策记录，因此本记录不能证明 hephi 检查通过；隐藏测试的独立复核
  未执行（Worker 自述本地 mirror/测试结果，未被本任务独立复跑验证）。无 PR 评审/CI（仓库无 CI 配置）。
- 4 个 off PR 均 OPEN、未合并；未修改 native PR；未产生任何效果/收益结论，样本量仍未锁定（PREREG pending）。
- eval 模式下本实例额外添加了 `b5-off-task` policy 规则并设 `mode=auto`（仅实例配置）；实际 Issue 因
  @paxxie2 成为显式请求（strength=explicit），不依赖该规则做接受判定。
- 清理状态：off 实例已停止、端口 3093 已关闭、临时 DeepSeek 凭据已删除、`/tmp/hephi-off-b5` 已删除；
  无 collaborator/invitation 残留；宿主 B pid 74123/端口 3083 未受影响。
- reviewer token 未复制到仓库/日志/凭据文件；`off-host.log` 的 web token 已 redact。
