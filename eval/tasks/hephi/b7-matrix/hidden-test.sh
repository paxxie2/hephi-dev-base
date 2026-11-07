#!/bin/sh
set -eu
out=$(node eval/b7-matrix.mjs --self-test 2>&1) || { echo "FAIL: b7-matrix self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "b7-matrix self-test" || { echo "FAIL: expected self-test evidence missing"; echo "$out"; exit 1; }
echo "PASS: b7-matrix self-test"
