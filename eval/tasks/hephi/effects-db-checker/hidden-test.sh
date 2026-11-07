#!/bin/sh
set -eu
out=$(node scripts/host/test-effects-db.mjs 2>&1) || { echo "FAIL: effects-db WAL probe exited non-zero"; echo "$out"; exit 1; }
echo "$out" | grep -q "0 failed" || { echo "FAIL: probe reported failures"; echo "$out"; exit 1; }
echo "$out" | grep -q "PASS:" || { echo "FAIL: probe did not report PASS"; echo "$out"; exit 1; }
echo "PASS: effects-db WAL read-only probe"
