#!/bin/sh
# B2 隐藏验收测试（合成示例）。
# 由 eval/check-task.mjs 在临时 checkout 的根目录执行；base 上应失败、参考修复后应通过。
set -eu
node test/hidden-check.mjs
