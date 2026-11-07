#!/bin/sh
set -eu
out=$(node eval/ab-metrics.mjs --self-test 2>&1) || { echo "FAIL: ab-metrics self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "ab-metrics self-test" || { echo "FAIL: expected self-test evidence missing"; echo "$out"; exit 1; }
echo "PASS: ab-metrics self-test"
