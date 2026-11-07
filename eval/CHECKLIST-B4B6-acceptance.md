# B4/B6 验收清单（工作包乙2 / `agent/b4b6-stats`）

- 基线：`main=29b127809d3389b693ca21b7e242e57086fafc99`（分支从该 commit 拉出）
- 分支：`agent/b4b6-stats`；独立克隆：`/tmp/b4b6`
- 修改范围：仅 `eval/**`（`eval/label/`、`eval/stats/`、`eval/evidence/b4b6/`）
- 独立性：未访问宿主、未跑正式实验、未 merge；Python 依赖全部装在 `/tmp/b4b6-venv`，仓库内无 `.venv`
- 证据：`eval/evidence/b4b6/validation-transcript.txt`（逐命令原始输出与退出码）、
  `eval/evidence/b4b6/pip-install.log`（依赖安装日志）、`eval/evidence/b4b6/versions.txt`（版本快照）
- 来源说明：本分支为第 3 次尝试。实现草案在前一次尝试的工作区中已存在，本次先将其整体备份到
  `/tmp/b4b6-attempt2-backup`，再在 `29b12780` 的全新克隆上重放并**逐项复核**；本清单中的全部
  命令与证据都由本工作区重新执行生成，未直接引用先前会话的日志。
- **诚实声明：本清单是“工具/统计实现验证通过”；真实盲评（两名真人）未做，正式实验数据不存在。
  不得把本清单当作真人盲评、正式实验结论或 PREREG 已锁定的证据。**

## 0. 环境（隔离 venv，固定版本）

| 项 | 值 | 证据 |
| --- | --- | --- |
| venv | `/tmp/b4b6-venv`（仓库外，未提交） | `versions.txt` |
| Python | 3.14.2 | 同上 |
| pip | 25.3 | 同上 |
| numpy | 2.3.4 | `pip freeze`（transcript §环境） |
| scipy | 1.16.2 | 同上 |
| statsmodels | 0.14.5 | 同上 |
| 安装命令 | `python3 -m venv /tmp/b4b6-venv && /tmp/b4b6-venv/bin/pip install --no-input -r eval/stats/requirements.txt` | `pip-install.log`，exit 0，`Successfully installed ... numpy-2.3.4 ... scipy-1.16.2 ... statsmodels-0.14.5` |

系统 `python3`（3.14.2）无这些依赖，作为依赖守卫负例（应 exit 2，不得抛栈、不得自写实现冒充）：

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `python3 eval/stats/kappa.py --self-test` | 2 | `[kappa] 缺少统计依赖：- numpy - statsmodels ...` |
| `python3 eval/stats/report.py --self-test` | 2 | `[report] 缺少统计依赖：- numpy - scipy - statsmodels ...` |

## 1. B4 盲评工具与 kappa（真实两名真人盲评未做）

| ID | 状态 | 命令 | 退出码 | 关键输出 / 覆盖点 | 未覆盖 / 限制 |
| --- | --- | --- | --- | --- | --- |
| B4-01 | 工具验证通过 | `node eval/label/export.mjs --self-test` | 0 | 干净材料导出成功且清单不含 `arm/taskId/runId` 键；三类硬痕迹拒导（exit 1）：hephi 痕迹、分支名 `agent/b4b6-stats`（`[branch-ref]`）、插件输出 `loadedShaReadback`（`[plugin-commit]`）；私有映射按 `blindId→runId/arm/taskId` 可还原且不落在材料目录；映射放进材料目录 → 拒绝（exit 2） | 只有合成材料；无真实运行材料。策略是 fail-closed 拒绝，没有“自动脱敏”。软痕迹只告警不阻断 |
| B4-02 | 工具验证通过 | `node eval/label/import.mjs --self-test` | 0 | 完整标注接受（exit 0）；缺 case、未知 case、manifest 重复 blindId、labels JSON 重复键、非法枚举、has=true 缺 notes/positions、has-defect 但 notes 无位置 → 全部 exit 1；has-defect 且 notes 含“文件:行” → exit 0；带私有映射还原为 run 级标注 | 只有合成标注；没有真人标注文件，真实 kappa/裁决链未跑。位置检查是正则启发式 |
| B4-03 | 已知答案通过 | `/tmp/b4b6-venv/bin/python eval/stats/kappa.py --scores /tmp/b4b6-fixtures/b4-03.json` | 0 | `n=4, po=1.0000, pe=0.5000, kappa=1.0000, threshold=0.7, pass=true`（statsmodels 0.14.5） | 合成数据 |
| B4-04 | 已知答案通过 | `... kappa.py --scores /tmp/b4b6-fixtures/b4-04.json` | 1 | 两类边际平衡、观测一致率 0.5：`po=0.5000, pe=0.5000, kappa=0.0000, pass=false`（`--json` 同样为 `kappa=0.0`） | 合成数据 |
| B4-05 | 已知答案通过 | `... kappa.py --scores /tmp/b4b6-fixtures/b4-05.json` | 1 | 全同标签：`po=1, pe=1, kappa=undefined, pass=false`；JSON `kappa:null, undefined:true`；**未返回假 1**。另验证不给 `labels`、由数据推导且全同的变体同样 undefined | 合成数据；statsmodels 对 0/0 返回 NaN，脚本显式映射为 undefined |
| 自测总览 | 通过 | `/tmp/b4b6-venv/bin/python eval/stats/kappa.py --self-test` | 0 | 12 项：statsmodels 来源断言（`cohens_kappa.__module__` 属 statsmodels）、B4-03/04/05、非法输入（文件不存在/非法 JSON/items 空/未知标签/缺 `--scores`/`--min` 非数字）全部 exit 2 | 依赖真实安装的 statsmodels |

`eval/stats/kappa.py` 输入沿用 `eval/kappa.mjs` 的 `labels/items/raterA/raterB`；kappa 数值只来自
`statsmodels.stats.inter_rater.cohens_kappa`，未自写 kappa 公式。`eval/kappa.mjs` 保留为 Node 兼容预检，未改。

## 2. B6 统计已知答案（合成数据；真实实验数据未跑）

主命令：

```sh
/tmp/b4b6-venv/bin/python eval/stats/report.py --self-test      # 原有自测，exit 0
/tmp/b4b6-venv/bin/python eval/stats/b6_known_answers.py        # 新增 B6 已知答案，exit 0
```

| ID | 状态 | 已知答案断言 | 关键输出 |
| --- | --- | --- | --- |
| B6-01 | 通过 | 6 改善 / 0 恶化 → 精确 McNemar `p=2*0.5^6=0.03125`，bootstrap CI=`[-1,-1]`，主指标判显著改善 | `p=0.03125 ci=[-1.0, -1.0] improved=True` |
| B6-02 | 通过（口径说明见下） | 守护指标 native 比 off 低 10pp（更差方向）→ `non_inferior=False`；主指标 native 越界率高 10pp（更差方向）→ 不判改善、联合判定 `not_meets_prereg` | `diff=-0.1 non_inferior=False`；`diff=0.1 improved=False conclusion=not_meets_prereg` |
| B6-04 | 通过 | `tokens.total=null` 不计 0：部分缺失时中位数只用已知值（100/200→150）；全部缺失时中位数为 N/A 且成本检查不通过 | `native_median_tokens=150.0`；全缺失 `median=None exceeded=['median_tokens_max','p90_tokens_max']` |
| B6-05 | 通过 | off 比率=0 → `relative_change=None` 标“不适用”（不除零）；分层 4 对 < `min_pairs=5` → 该层“证据不足”，6 对层正常计算 | `off_rate=0.0 relative=None note=对照组为 0，相对变化不适用`；`repo/a={'n_pairs':4,'conclusion':'证据不足'}` |
| B6-06 | 通过（含最小修复） | `validationEnvironment.status=unavailable` 运行不计效果（`paired_tasks=2`）但其成本保留并计入成本统计 | `env_unavailable=1 pairs=2 tokens=200.0 minutes=20.0` |
| B6-07 | 通过 | 同一 runs 数据 + 同一 seed，两次 CLI `--format json` 输出逐字节一致 | `exit=0/0 bytes=7467 identical=True` |
| report 自测 | 通过 | 原有 11 项已知答案（McNemar p/CI、非劣效正反例、成本超限/未超限、样本不足、输入校验）全部 PASS | `SELF-TEST: PASS` |

B6-02 口径说明：任务书写“native 高 10pp 不得判非劣效”。报告中的“非劣效”只定义在“越大越好”的守护指标上
（`eval/PREREG.md` §3），因此按两个方向都做了断言：(a) 守护指标 native 低 10pp → 非劣效不成立；
(b) 主指标越界率高 10pp（更差）→ 不判改善、不判达标。两种更差方向都未放过。

## 3. 最小修复说明（不改主分析方案）

1. `eval/stats/report.py`（8 行）：`evaluate_cost` 原来只统计 `env_available` 的运行，导致
   “环境不可用”运行的成本被丢弃。按 `eval/PREREG.md` §7“排除（从效果指标中排除，但保留记录并计入
   成本/稳定性）”，改为成本统计包含全部运行；效果指标仍只用有效配对。`analyze` 传参同步为全量 runs。
2. `eval/label/import.mjs`：按 `eval/label/RUBRIC.md` §5 增加两条校验——`has-defect` 时 `notes`
   必须写明缺陷位置（文件+行）；manifest 与 labels 原始文本中的重复 blindId 拒绝（JSON.parse 会静默
   去重，故在原文上检查）。二者均属任务书 B4-02 要求的“缺失/重复/缺陷无位置说明 → 拒绝”。
3. `eval/label/export.mjs`：只新增 B4-01 自测（分支名/插件输出硬痕迹拒导、私有映射可还原），
   复用已有的硬痕迹检测逻辑，未改导出语义、未新增“脱敏”路径。

## 4. 变更文件

```text
eval/stats/kappa.py                  新增（statsmodels Cohen's kappa CLI + 自测）
eval/stats/b6_known_answers.py       新增（B6 已知答案验证，合成数据）
eval/stats/report.py                 最小修复（成本统计保留环境不可用运行）
eval/label/export.mjs                B4-01 自测新增（无导出语义改动）
eval/label/import.mjs                B4-02 校验增强 + 自测新增
eval/CHECKLIST-B4B6-acceptance.md    本清单（新增）
eval/evidence/b4b6/versions.txt      环境版本（新增）
eval/evidence/b4b6/pip-install.log   依赖安装日志（新增）
eval/evidence/b4b6/validation-transcript.txt  逐命令证据（新增）
```

## 5. 验收门禁（全部真实执行）

| 门禁 | 命令 | 退出码 |
| --- | --- | --- |
| kappa 自测 | `/tmp/b4b6-venv/bin/python eval/stats/kappa.py --self-test` | 0 |
| report 自测 | `/tmp/b4b6-venv/bin/python eval/stats/report.py --self-test` | 0 |
| B6 已知答案 | `/tmp/b4b6-venv/bin/python eval/stats/b6_known_answers.py` | 0 |
| B4-01 自测 | `node eval/label/export.mjs --self-test` | 0 |
| B4-02 自测 | `node eval/label/import.mjs --self-test` | 0 |
| JS 语法 | `node --check eval/label/export.mjs eval/label/import.mjs`（逐个执行） | 0 |
| Python 语法 | `/tmp/b4b6-venv/bin/python -m py_compile eval/stats/{kappa,report,b6_known_answers}.py` | 0 |
| 空白/补丁卫生 | `git diff --check` | 0 |
| 依赖守卫负例 | 系统 `python3` 跑 kappa/report 自测 | 2 / 2（预期） |

## 6. 复现命令汇总

```sh
# 环境（仓库外，不提交 venv）
python3 -m venv /tmp/b4b6-venv
/tmp/b4b6-venv/bin/pip install --no-input -r eval/stats/requirements.txt
/tmp/b4b6-venv/bin/pip freeze | grep -Ei '^(numpy|scipy|statsmodels)=='   # 2.3.4 / 1.16.2 / 0.14.5

# B4
node eval/label/export.mjs --self-test
node eval/label/import.mjs --self-test
/tmp/b4b6-venv/bin/python eval/stats/kappa.py --self-test
/tmp/b4b6-venv/bin/python eval/stats/kappa.py --scores /tmp/b4b6-fixtures/b4-03.json   # exit 0
/tmp/b4b6-venv/bin/python eval/stats/kappa.py --scores /tmp/b4b6-fixtures/b4-04.json   # exit 1
/tmp/b4b6-venv/bin/python eval/stats/kappa.py --scores /tmp/b4b6-fixtures/b4-05.json   # exit 1（undefined）

# B6
/tmp/b4b6-venv/bin/python eval/stats/report.py --self-test
/tmp/b4b6-venv/bin/python eval/stats/b6_known_answers.py

# 静态
node --check eval/label/export.mjs && node --check eval/label/import.mjs
/tmp/b4b6-venv/bin/python -m py_compile eval/stats/kappa.py eval/stats/report.py eval/stats/b6_known_answers.py
git diff --check
```

`/tmp/b4b6-fixtures/` 中的 3 个 scores.json 是合成已知答案数据（`b4-03` 2+2 完全一致、`b4-04` 平衡边际、
`b4-05` 全同标签），不提交仓库。

## 7. 未覆盖 / 未验证（必须如实记录）

1. **真实两名真人盲评未做**：无真人标注文件、无真人 kappa、无裁决记录；B4 全部条目仅为工具自测。
2. **正式实验未跑**：B5/B6 无真实运行记录；本清单所有 B6 结论均为合成数据已知答案，不是实验结果。
3. B6-03 未在任务书给出验收口径，本次未覆盖（需 Lead 补充定义）。
4. `eval/PREREG.md` 仍未锁定（D-1..D-10 未批准），成本上限/非劣效界值/min_pairs 仍是占位值；工具按占位值运行。
5. `export.mjs` 没有“自动脱敏”实现，只有拒绝导出；材料含组别痕迹时只能人工清理后重导。
6. B4-02 对 `implementationDefect.notes` 的“位置”检查是正则启发式（文件:行 / 第 N 行 / LNN），不解析 diff 定位。
7. 未在真实运行材料上验证 `export.mjs` 的 git diff 路径（合成仓库只覆盖单文件 diff 与三类硬痕迹）。
8. 未在真实批次上验证 `report.py` 的 bootstrap/分层输出与 PREREG 锁定后的最终口径。
