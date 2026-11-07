#!/bin/sh
set -eu
out=$(node eval/daily/export.mjs --self-test 2>&1) || { echo "FAIL: export self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "export self-test" || { echo "FAIL: export self-test evidence missing"; echo "$out"; exit 1; }
out2=$(node eval/daily/rework.mjs --self-test 2>&1) || { echo "FAIL: rework self-test exited non-zero"; echo "$out2"; exit 1; }
echo "$out2" | grep -q "rework self-test" || { echo "FAIL: rework self-test evidence missing"; echo "$out2"; exit 1; }
echo "PASS: daily export and rework self-tests"
