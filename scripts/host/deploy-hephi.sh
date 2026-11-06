#!/bin/sh
# P8 插件部署：检查暂停/排空 → 构建 → 重启实例 → 实载回读；任一步失败保持暂停并非零退出。
# 必须人工执行。--dry-run 只做检查（可配 --skip-build 跳过构建，用于在宿主上先验证前置条件）。
# 用法：./scripts/host/deploy-hephi.sh --instance <dir> --host <url> [--hephi <dir>] [--repo <dir>] [--dry-run] [--skip-build] [--timeout <sec>]
#   --hephi 插件源码目录（默认 <instance>/hephi；本机实验实例为 <instance>/hephi-review/hephi）
#   --repo  用于回读 commit 的 git 仓库根（默认 <instance>；本机实验实例为 <instance>/hephi-review）
set -eu

usage() {
  echo "usage: $0 --instance <dir> --host <url> [--hephi <dir>] [--repo <dir>] [--dry-run] [--skip-build] [--timeout <sec>]" >&2
  exit 2
}

instance=""
host=""
hephi=""
repo=""
dry_run="no"
skip_build="no"
timeout=120
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; instance="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; host="$2"; shift 2 ;;
    --hephi) [ $# -ge 2 ] || usage; hephi="$2"; shift 2 ;;
    --repo) [ $# -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --dry-run) dry_run="yes"; shift ;;
    --skip-build) skip_build="yes"; shift ;;
    --timeout) [ $# -ge 2 ] || usage; timeout="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done
[ -n "$instance" ] && [ -n "$host" ] || usage
[ -d "$instance" ] || { echo "实例目录不存在：$instance" >&2; exit 2; }
[ -f "$instance/host.pid" ] || { echo "缺少 host.pid：$instance/host.pid" >&2; exit 2; }
[ -n "$hephi" ] || hephi="$instance/hephi"
[ -n "$repo" ] || repo="$instance"
[ -d "$hephi" ] || { echo "插件目录不存在：$hephi" >&2; exit 2; }
host=${host%/}

read_state() {
  curl -fsS -H 'x-orchestrator-request: 1' "$host/orchestrator/api/state"
}

state=$(read_state) || { echo "宿主状态不可读：$host" >&2; exit 1; }
values=$(printf '%s' "$state" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write([j.load?.running, j.load?.queued, j.paused, j.health?.runtime?.state].map(v=>String(v)).join(" "))})')
set -- $values
running="$1"
queued="$2"
paused="$3"
runtime="$4"
echo "部署前状态：running=$running queued=$queued paused=$paused runtime=$runtime"
[ "$paused" = "true" ] || { echo "宿主未暂停，拒绝部署：先暂停评估/派发/出站并排空在途任务" >&2; exit 1; }
[ "$running" = "0" ] && [ "$queued" = "0" ] || { echo "仍有运行或排队任务，拒绝部署：$running/$queued" >&2; exit 1; }

sha=$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo unknown)
echo "实例仓库 HEAD：$sha"

if [ "$skip_build" = "no" ]; then
  ( cd "$hephi" && pnpm install --frozen-lockfile && pnpm check ) || { echo "构建失败，保持暂停，不切换" >&2; exit 1; }
fi
if [ "$dry_run" = "yes" ]; then
  echo "dry-run：暂停/排空检查与构建通过，未重启实例"
  exit 0
fi

pid=$(cat "$instance/host.pid")
kill -TERM "$pid" 2>/dev/null || true
waited=0
while kill -0 "$pid" 2>/dev/null; do
  [ "$waited" -ge "$timeout" ] && { echo "实例未在 ${timeout}s 内退出，保持暂停并人工接管" >&2; exit 1; }
  sleep 2
  waited=$((waited + 2))
done

nohup "$instance/start.sh" >> "$instance/logs/host.log" 2>&1 &
echo $! > "$instance/host.pid"
waited=0
while :; do
  if after=$(read_state 2>/dev/null); then
    after_values=$(printf '%s' "$after" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write([j.load?.running, j.load?.queued, j.paused, j.health?.runtime?.state].map(v=>String(v)).join(" "))})')
    set -- $after_values
    if [ "$4" = "ready" ]; then
      record="$instance/logs/deploy-$(date +%Y%m%dT%H%M%S).json"
      printf '{"at":"%s","instance":"%s","host":"%s","repoHead":"%s","before":{"running":%s,"queued":%s,"paused":%s,"runtime":"%s"},"after":{"running":%s,"queued":%s,"paused":%s,"runtime":"%s"}}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$instance" "$host" "$sha" "$running" "$queued" "$paused" "$runtime" "$1" "$2" "$3" "$4" > "$record"
      echo "部署完成：$record"
      echo "注意：describePlugin 无调用入口，实载版本仍需人工核对；确认后手动取消暂停。"
      exit 0
    fi
  fi
  [ "$waited" -ge "$timeout" ] && { echo "重启后未在 ${timeout}s 内 ready，保持暂停并人工接管" >&2; exit 1; }
  sleep 2
  waited=$((waited + 2))
done
