#!/bin/sh
set -eu
out=$(node eval/prereg-lock.mjs --self-test 2>&1) || { echo "FAIL: prereg-lock self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "prereg-lock self-test" || { echo "FAIL: expected self-test evidence missing"; echo "$out"; exit 1; }
echo "PASS: prereg-lock self-test"
