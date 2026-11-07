#!/bin/sh
set -eu
out=$(node eval/daily/verify-export.mjs --self-test 2>&1) || { echo "FAIL: verify-export self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "verify-export self-test" || { echo "FAIL: expected self-test evidence missing"; echo "$out"; exit 1; }
echo "PASS: verify-export self-test"
