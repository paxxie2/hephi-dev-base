#!/bin/sh
set -eu
out=$(node eval/record-run.mjs --self-test 2>&1) || { echo "FAIL: record-run self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "SELF-TEST: PASS" || { echo "FAIL: expected self-test evidence missing"; echo "$out"; exit 1; }
echo "PASS: record-run self-test"
