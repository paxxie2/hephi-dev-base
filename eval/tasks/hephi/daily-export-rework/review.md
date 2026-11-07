# 合法范围复核（agent 辅助评审）

本任务由 B2 执行者（agent 辅助）从本地真实仓库历史提交 `2b89d845a751f13e4d1b6cf2388ef879d3ac9625`（`B8: daily export, rework candidates, maintenance and appeal docs`）派生：
固定 base `d0a84acc0436d81c314e899e93d5c26ea4c8fa7f` 为该提交的父提交，`reference.patch` 是该提交对这些文件的真实 `git diff`。

## 合法范围
合法范围仅限 `reference.patch` 中的文件：`eval/daily/APPEALS.md`, `eval/daily/MAINTENANCE.md`, `eval/daily/export.mjs`, `eval/daily/rework.mjs`。没有加入任何额外的无关修改；`task.json.allowedFiles` 与补丁文件一一对应，full-mode 的 `allowed-scope` 检查确认 `outside=[]`。

## 评审者说明（如实）
**评审者为 agent 辅助评审，非两名人类评审。** 本轮没有第二独立人类复核者、没有评审者签名或裁决记录；本文件不能作为双人人类评审证据。

## 已经实际执行（full-mode，非 dry-run）
`node eval/check-task.mjs <taskDir> --repo <本机仓库> --repeats 3 --json`：base 隐藏测试退出码非 0（目标断言/模块缺失，见 `eval/B2-audit.md` 中记录的 exit code 与 outputSha256），应用 `reference.patch` 后 3/3 通过且 3 次输出一致，范围检查无越界。原始 JSON 由执行者保存在本地临时证据目录，未伪造。

## 未验证项
未做真实模型运行、未做人类双评审、未验证该提交在完整仓库工具链下的全部回归测试（hidden-test 只覆盖本任务目标断言）；污染门槛未达标（见 task.json.contamination）。
