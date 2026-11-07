# B5 试跑配对核验（2026-11-08，Lead 亲手执行）

- 任务：`previous-window-order`（site-pnl，base `1e166fbe…`）
- 隐藏测试：`eval/tasks/site-pnl-diagnosis/previous-window-order/hidden-test.sh`（Python 标准库，直接 import money.py）
- 方法：分别克隆 `paxxie2/b5-native-site-pnl` 与 `paxxie2/b5-off-site-pnl`，在 base 与 8 个 PR head 上执行同一隐藏测试。

## 结果

| 组 | run | head | 隐藏测试 | 备注 |
| --- | --- | --- | --- | --- |
| native | base | `1e166fb` | **exit 1**（AssertionError） | base 目标断言失败，符合任务有效性 |
| native | run1 | `5344800` | exit 0 PASS | ticket=blocked（complete project-regression 因 base 缺 app.data），PR #3 draft |
| native | run1-retry | `b152f8e` | exit 0 PASS | ticket=ready，PR #5 |
| native | run2 | `c28e6ee` | exit 0 PASS | ticket=ready，PR #8 |
| native | run3 | `a85034c` | exit 0 PASS | ticket=ready，PR #9 |
| off | run1 | `87b12ae` | exit 0 PASS | ticket=ready，PR #8（off 仓库） |
| off | run1-retry | `e301bae` | exit 0 PASS | ticket=ready，PR #10 |
| off | run2 | `9c9c664` | exit 0 PASS | ticket=ready，PR #12 |
| off | run3 | `78c4418` | exit 0 PASS | ticket=ready，PR #14 |

命令（真实执行；cwd 为各自仓库根）：
```sh
sh eval/tasks/site-pnl-diagnosis/previous-window-order/hidden-test.sh
# base: exit 1 / AssertionError: reversed date window must raise ValueError
# 8 个 PR head: exit 0 / previous_window boundary checks PASS
```

## 解释与限制

1. off PR 全部通过同一隐藏测试；native 4 个 head 也全部通过。任务级成果一致。
2. **off 使用回退仓库** `b5-off-site-pnl`（非同仓配对）：任务文本 `@paxxie2 ` + `issue.md` 逐字节一致（sha `a54c17e9…`），但仓库/环境/PR 位置不同，配对性弱于同仓；不得当作正式同仓对照。
3. **native 合同/检查口径混杂**：run1 的 project-regression 为完整 `scripts/check.sh`（因 base 缺 `backend/app/data` 失败→blocked）；run1-retry/2/3 的合同把 project-regression 收窄为 `pytest backend/tests/test_money.py`（ready）。该差异来自检查配置变更，不是任务实现差异。
4. native body 比 off 多 `hephi-task` 合同块（670 bytes，处理组元数据）；任务指令部分一致。
5. 本核验只证明隐藏测试在 8 个 head 上通过、base 失败；不证明 B5 效果/收益，不是 PREREG 锁定后的正式实验。
