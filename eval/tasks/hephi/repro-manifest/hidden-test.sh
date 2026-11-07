#!/bin/sh
set -eu
out=$(node eval/repro-manifest.mjs --self-test 2>&1) || { echo "FAIL: repro-manifest self-test exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "repro-manifest self-test" || { echo "FAIL: expected self-test evidence missing"; echo "$out"; exit 1; }
echo "PASS: repro-manifest self-test"
