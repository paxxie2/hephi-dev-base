#!/bin/sh
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
cat > "$tmp/PREREG.md" <<'PREREG'
# B1 预注册（测试合成夹具）

状态：已决（测试夹具，不含未决标记）。

- 非劣效界值：-0.05（测试夹具值）
- 样本量：测试夹具值
PREREG
cat > "$tmp/decisions-draft.md" <<'DEC'
# B 线决策草案（测试合成夹具，不是真实批准记录）

## D-1 非劣效界值

- status: `approved`
- 批准人：测试夹具

## D-2 主指标联合规则

- status: `approved`
- 批准人：测试夹具
DEC
out=$(node eval/prereg-lock.mjs --check --eval-dir "$tmp" 2>&1) || { echo "FAIL: --check must pass on decided synthetic inputs"; echo "$out"; exit 1; }
echo "$out" | grep -q "version: schemaVersion=" || { echo "FAIL: --check output lacks the tool version line"; echo "$out"; exit 1; }
echo "$out" | grep -q "preregSha256=" || { echo "FAIL: --check output lacks the prereg hash"; echo "$out"; exit 1; }
code=0
real=$(node eval/prereg-lock.mjs --check 2>&1) || code=$?
if [ "$code" -eq 0 ]; then echo "FAIL: real pending markers must still fail closed"; exit 1; fi
echo "$real" | grep -q "UNRESOLVED" || { echo "FAIL: fail-closed evidence missing"; echo "$real"; exit 1; }
echo "PASS: prereg-lock --check prints tool version"
