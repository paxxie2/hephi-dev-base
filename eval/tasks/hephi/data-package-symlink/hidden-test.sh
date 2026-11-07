#!/bin/sh
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
mkdir -p "$tmp/sub"
ln -s ../sub "$tmp/sub/link"
ln -s "$tmp/missing-target" "$tmp/dangling"
code=0
out=$(node eval/check-data-package.mjs --package "$tmp" 2>/dev/null) || code=$?
if [ "$code" -ne 1 ]; then echo "FAIL: expected exit 1 for data-package findings, got $code"; exit 1; fi
echo "$out" | grep -q '"kind": "symlink"' || { echo "FAIL: symlink findings missing"; echo "$out"; exit 1; }
code=0
out2=$(node eval/export-baseline.mjs --db "$tmp/missing.db" --out "$tmp/out" 2>&1) || code=$?
if [ "$code" -ne 2 ]; then echo "FAIL: missing database should exit 2, got $code"; echo "$out2"; exit 1; fi
echo "$out2" | grep -q '读取数据库失败' || { echo "FAIL: explicit missing-db message missing"; echo "$out2"; exit 1; }
echo "PASS: symlink scan and explicit missing-db error"
