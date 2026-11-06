#!/bin/sh
# P8 插件部署：检查暂停/排空 → 快照当前构建 → 构建 → 发布不可变构建 → 重启实例 → 实载回读/健康检查。
# --rollback 用最近一次部署前的快照恢复，并再次健康检查；失败保持暂停并非零退出。
# 必须人工执行。--dry-run 只做检查与构建，不重启。
# 用法：./scripts/host/deploy-hephi.sh --instance <dir> --host <url> [--hephi <dir>] [--repo <dir>]
#        [--releases <dir>] [--dry-run] [--skip-build] [--rollback] [--allow-open-tickets] [--timeout <sec>]
#   --hephi 插件源码目录（默认 <instance>/hephi；本机实验实例为 <instance>/hephi-review/hephi）
#   --repo  用于回读 commit 的 git 仓库根（默认 <instance>；本机实验实例为 <instance>/hephi-review）
#   --releases 不可变构建目录（默认 <instance>/releases/hephi）
set -eu

usage() {
  echo "usage: $0 --instance <dir> --host <url> [--hephi <dir>] [--repo <dir>] [--releases <dir>] [--dry-run] [--skip-build] [--rollback] [--allow-open-tickets] [--timeout <sec>]" >&2
  exit 2
}

instance=""
host=""
hephi=""
repo=""
releases=""
dry_run="no"
skip_build="no"
rollback="no"
allow_open="no"
timeout=120
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; instance="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; host="$2"; shift 2 ;;
    --hephi) [ $# -ge 2 ] || usage; hephi="$2"; shift 2 ;;
    --repo) [ $# -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --releases) [ $# -ge 2 ] || usage; releases="$2"; shift 2 ;;
    --dry-run) dry_run="yes"; shift ;;
    --skip-build) skip_build="yes"; shift ;;
    --rollback) rollback="yes"; shift ;;
    --allow-open-tickets) allow_open="yes"; shift ;;
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
[ -n "$releases" ] || releases="$instance/releases/hephi"
[ -d "$hephi" ] || { echo "插件目录不存在：$hephi" >&2; exit 2; }
host=${host%/}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

read_state() { curl -fsS -H 'x-orchestrator-request: 1' "$host/orchestrator/api/state"; }

state_fields() {
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write([j.load?.running, j.load?.queued, j.paused, j.health?.runtime?.state].map(v=>String(v)).join(" "))})'
}

restart_instance() {
  pid=$(cat "$instance/host.pid")
  kill -TERM "$pid" 2>/dev/null || true
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    [ "$waited" -ge "$timeout" ] && { echo "实例未在 ${timeout}s 内退出，保持暂停并人工接管" >&2; return 1; }
    sleep 2; waited=$((waited + 2))
  done
  nohup "$instance/start.sh" >> "$instance/logs/host.log" 2>&1 &
  echo $! > "$instance/host.pid"
  waited=0
  while :; do
    if after=$(read_state 2>/dev/null); then
      set -- $(state_fields "$after")
      [ "$4" = "ready" ] && { AFTER="$after"; return 0; }
    fi
    [ "$waited" -ge "$timeout" ] && { echo "重启后未在 ${timeout}s 内 ready，保持暂停并人工接管" >&2; return 1; }
    sleep 2; waited=$((waited + 2))
  done
}

snapshot_live() {
  [ -d "$hephi/lib" ] || return 0
  mkdir -p "$releases"
  dir="$releases/live-$(date +%Y%m%dT%H%M%S)"
  mkdir -p "$dir"
  cp -R "$hephi/lib" "$dir/lib"
  printf '{"origin":"live-snapshot","at":"%s","entrySha256":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(sha256_file "$hephi/lib/index.mjs")" > "$dir/meta.json"
  printf '%s\n' "$dir" > "$releases/last-snapshot"
  echo "$dir"
}

publish_release() {
  mkdir -p "$releases/$sha"
  rm -rf "$releases/$sha/lib"
  cp -R "$hephi/lib" "$releases/$sha/lib"
  printf '{"sha":"%s","at":"%s","entrySha256":"%s"}\n' \
    "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(sha256_file "$hephi/lib/index.mjs")" > "$releases/$sha/meta.json"
  echo "$releases/$sha"
}

state=$(read_state) || { echo "宿主状态不可读：$host" >&2; exit 1; }
set -- $(state_fields "$state")
running="$1"; queued="$2"; paused="$3"; runtime="$4"
echo "部署前状态：running=$running queued=$queued paused=$paused runtime=$runtime"
[ "$paused" = "true" ] || { echo "宿主未暂停，拒绝部署：先暂停评估/派发/出站并排空在途任务" >&2; exit 1; }
[ "$running" = "0" ] && [ "$queued" = "0" ] || { echo "仍有运行或排队任务，拒绝部署：$running/$queued" >&2; exit 1; }

# 有进行中的 Ticket 时禁止升级（P5/P8）；需显式 --allow-open-tickets 才跳过。
if [ "$allow_open" = "no" ]; then
  open_tickets=$(curl -fsS -H 'x-orchestrator-request: 1' "$host/orchestrator/api/tickets?state=open&limit=1000" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const list=Array.isArray(j)?j:(j.tickets??j.items??[]);process.stdout.write(String(list.length))}catch(e){process.stdout.write("unknown")}})')
  case "$open_tickets" in
    ''|*[!0-9]*) echo "无法确认进行中的 Ticket 数量，拒绝部署（可用 --allow-open-tickets 显式跳过）" >&2; exit 1 ;;
  esac
  [ "$open_tickets" -eq 0 ] || { echo "仍有 $open_tickets 个进行中的 Ticket，禁止升级；处理完或用 --allow-open-tickets 显式跳过" >&2; exit 1; }
  echo "进行中 Ticket 检查：0"
fi

sha=$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo unknown)
echo "实例仓库 HEAD：$sha"

if [ "$rollback" = "yes" ]; then
  [ -f "$releases/last-snapshot" ] || { echo "没有可回滚快照：$releases/last-snapshot 不存在" >&2; exit 1; }
  snap=$(cat "$releases/last-snapshot")
  [ -d "$snap/lib" ] || { echo "快照内容缺失：$snap/lib" >&2; exit 1; }
  before=$(sha256_file "$hephi/lib/index.mjs" 2>/dev/null || echo unknown)
  rm -rf "$hephi/lib.rollback-$$"
  cp -R "$snap/lib" "$hephi/lib.rollback-$$"
  rm -rf "$hephi/lib.live-$$"
  mv "$hephi/lib" "$hephi/lib.live-$$"
  mv "$hephi/lib.rollback-$$" "$hephi/lib"
  if ! restart_instance; then
    rm -rf "$hephi/lib"; mv "$hephi/lib.live-$$" "$hephi/lib"
    echo "回滚后健康检查失败，已恢复回滚前构建；保持暂停并人工接管" >&2
    exit 1
  fi
  rm -rf "$hephi/lib.live-$$"
  after_entry=$(sha256_file "$hephi/lib/index.mjs")
  record="$instance/logs/rollback-$(date +%Y%m%dT%H%M%S).json"
  printf '{"at":"%s","instance":"%s","host":"%s","action":"rollback","snapshot":"%s","entryBefore":"%s","entryAfter":"%s","after":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$instance" "$host" "$snap" "$before" "$after_entry" "$AFTER" > "$record"
  echo "回滚完成：$record"
  echo "注意：describePlugin 无调用入口，实载版本仍需人工核对；确认后手动取消暂停。"
  exit 0
fi

if [ "$skip_build" = "no" ]; then
  snap=$(snapshot_live)
  [ -n "$snap" ] && echo "已快照当前构建：$snap"
  ( cd "$hephi" && pnpm install --frozen-lockfile && pnpm check ) || { echo "构建失败，保持暂停，不切换" >&2; exit 1; }
  release=$(publish_release)
  echo "已发布不可变构建：$release"
fi
if [ "$dry_run" = "yes" ]; then
  echo "dry-run：暂停/排空检查与构建通过，未重启实例"
  exit 0
fi

if ! restart_instance; then
  echo "重启失败，保持暂停并人工接管" >&2
  exit 1
fi
record="$instance/logs/deploy-$(date +%Y%m%dT%H%M%S).json"
printf '{"at":"%s","instance":"%s","host":"%s","repoHead":"%s","release":"%s","snapshot":"%s","before":{"running":%s,"queued":%s,"paused":%s,"runtime":"%s"},"after":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$instance" "$host" "$sha" "${release:-none}" "${snap:-none}" \
  "$running" "$queued" "$paused" "$runtime" "$AFTER" > "$record"
echo "部署完成：$record"
echo "注意：describePlugin 无调用入口，实载版本仍需人工核对；确认后手动取消暂停。"
