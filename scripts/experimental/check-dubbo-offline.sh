#!/bin/sh
# P10 任务有效性/离线稳定性：同一命令连续运行 N 次并核对预期结果；base 负例用 --expect fail。
# 离线由调用方保证（例如 mvn -o），本脚本只核对次数、退出码、耗时与一致性，不声称“离线已证明”。
# 用法：./scripts/experimental/check-dubbo-offline.sh --dir <任务目录> --command '<命令>' [--runs 3] --expect pass|fail
set -eu

usage() {
  echo "usage: $0 --dir <task-dir> --command '<cmd>' [--runs 3] --expect pass|fail" >&2
  exit 2
}

dir=""
command=""
runs=3
expect=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || usage; dir="$2"; shift 2 ;;
    --command) [ $# -ge 2 ] || usage; command="$2"; shift 2 ;;
    --runs) [ $# -ge 2 ] || usage; runs="$2"; shift 2 ;;
    --expect) [ $# -ge 2 ] || usage; expect="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done
[ -n "$dir" ] && [ -n "$command" ] && [ -n "$expect" ] || usage
[ -d "$dir" ] || { echo "任务目录不存在：$dir" >&2; exit 2; }
case "$expect" in pass|fail) ;; *) echo "--expect 只能是 pass 或 fail" >&2; exit 2 ;; esac
case "$runs" in ''|*[!0-9]*) echo "--runs 必须是数字" >&2; exit 2 ;; esac
[ "$runs" -ge 1 ] || { echo "--runs 至少为 1" >&2; exit 2; }

results=""
i=1
while [ "$i" -le "$runs" ]; do
  start=$(date +%s)
  set +e
  ( cd "$dir" && sh -c "$command" ) >/dev/null 2>&1
  code=$?
  set -e
  end=$(date +%s)
  duration=$((end - start))
  results="$results${results:+,}{\"run\":$i,\"exit\":$code,\"durationSec\":$duration}"
  echo "run $i: exit=$code duration=${duration}s"
  i=$((i + 1))
done

node -e 'const [dir,command,expect,runs,results] = process.argv.slice(1); const rs = JSON.parse("[" + results + "]"); const codes = [...new Set(rs.map(r => r.exit))]; const consistent = codes.length === 1; const passThis = expect === "pass" ? codes[0] === 0 : codes[0] !== 0; const out = { dir, command, expect, runs: Number(runs), consistent, exitCodes: codes, results: rs, ok: consistent && passThis }; console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1)' \
  "$dir" "$command" "$expect" "$runs" "$results"
