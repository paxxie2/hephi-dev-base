#!/bin/sh
# P8 部署：不可变构建发布、原子切换、全健康门禁、失败自动回滚、显式实载边界。
#
# 不变量（实现与 test-deploy-hephi.mjs 共同验证）：
# 1. releases/<fullSHA>/ 发布成功后其 lib/ 与 meta.json 永不改写；同 SHA 再发布必须失败。
# 2. 构建在独立临时目录（git archive 干净源码）完成，绝不在实载 $hephi/lib 上构建。
# 3. 实载切换只使用已发布且校验通过的 release；校验失败不得停止当前宿主。
# 4. 切换后的重启或健康失败自动恢复 previous，并再次执行全量健康检查。
# 5. 回滚也失败时保持 paused=true、非零退出、保留现场与两次健康证据，不接新任务。
# 6. 有进行中 Ticket、drain 字段未知或非零时禁止升级；不存在绕过入口。
# 7. 成功退出也不自动恢复派发；由操作者核对后手动恢复。
# 8. 文件哈希只证明磁盘内容，不等于实载 commit；无实载回读入口时 P8 真实验收保持未通过。
#
# 用法：deploy-hephi.sh --instance <dir> --host <url> --host-version <单行值>
#        [--target <40sha>] [--previous <40sha>] [--rollback] [--dry-run]
#        [--releases <dir>] [--repo <dir>] [--hephi <dir>] [--timeout <秒>]
set -eu

usage() {
  cat >&2 <<'USAGE'
usage: deploy-hephi.sh --instance <dir> --host <url> --host-version <single-line value>
       [--target <40sha>] [--previous <40sha>] [--rollback] [--dry-run]
       [--releases <dir>] [--repo <dir>] [--hephi <dir>] [--timeout <seconds>]
USAGE
  exit 2
}

instance=""; host=""; host_version=""; target=""; previous=""; rollback="no"; dry_run="no"
releases=""; repo=""; hephi=""; timeout=120
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; instance="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; host="$2"; shift 2 ;;
    --host-version) [ $# -ge 2 ] || usage; host_version="$2"; shift 2 ;;
    --target) [ $# -ge 2 ] || usage; target="$2"; shift 2 ;;
    --previous) [ $# -ge 2 ] || usage; previous="$2"; shift 2 ;;
    --rollback) rollback="yes"; shift ;;
    --dry-run) dry_run="yes"; shift ;;
    --releases) [ $# -ge 2 ] || usage; releases="$2"; shift 2 ;;
    --repo) [ $# -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --hephi) [ $# -ge 2 ] || usage; hephi="$2"; shift 2 ;;
    --timeout) [ $# -ge 2 ] || usage; timeout="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
[ -n "$instance" ] && [ -n "$host" ] && [ -n "$host_version" ] || usage
lines=$(printf '%s\n' "$host_version" | wc -l | tr -d ' ')
[ "$lines" -eq 1 ] || { echo "host version must be a single-line value" >&2; exit 2; }
printf '%s' "$host_version" | grep -qE '^[[:print:]]+$' || { echo "host version must be a non-empty printable value" >&2; exit 2; }
[ -d "$instance" ] || { echo "instance directory not found: $instance" >&2; exit 2; }
[ -n "$hephi" ] || hephi="$instance/hephi"
[ -n "$repo" ] || repo="$instance"
[ -n "$releases" ] || releases="$instance/releases/hephi"
[ -d "$hephi" ] || { echo "plugin directory not found: $hephi" >&2; exit 2; }
[ -d "$repo/.git" ] || [ -f "$repo/.git" ] || { echo "not a git repository: $repo" >&2; exit 2; }
[ -f "$instance/host.pid" ] || { echo "missing host.pid: $instance/host.pid" >&2; exit 2; }
host=${host%/}
release_sha() { printf '%s' "$1" | sed -n 's#.*/\([0-9a-f]\{40\}\)/lib$#\1#p'; }
is_sha() { printf '%s' "$1" | grep -qE '^[0-9a-f]{40}$'; }
sha256_file() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

read_state() { curl -fsS -H 'x-orchestrator-request: 1' "$host/orchestrator/api/state"; }
read_load() {
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(JSON.stringify({paused:j.paused,load:j.load??{},health:j.health??{}}))})'
}

# 全量健康：任一必要服务缺失、starting 或 error 都失败。
health_ok() {
  printf '%s' "$1" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s); const required=["runtime","relay","notice","launch","delivery","assessment","reply","evals","models","github"];
      const problems=[]; for(const name of required){const h=j.health&&j.health[name]; if(!h||h.state!=="ready")problems.push(name+"="+((h&&h.state)||"missing"));}
      if(problems.length){console.error("unhealthy: "+problems.join(", "));process.exit(1);}
    })' >&2
}

# 排空：known 字段须为 0；未知/缺失字段记为 unverified 并拒绝升级。
drain_ok() {
  printf '%s' "$1" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s); const load=j.load??{};
      const required=["running","queued"];
      const optional=["startupReservations","effects","jobs","subagents","unknown"];
      const problems=[];
      for(const name of required){ if(!Number.isInteger(load[name])) problems.push("unverified drain field: "+name); else if(load[name]!==0) problems.push("drain field "+name+"="+load[name]); }
      for(const name of optional){ if(load[name]===undefined) problems.push("unverified drain field: "+name); else if(load[name]!==0) problems.push("drain field "+name+"="+load[name]); }
      if(problems.length){console.error(problems.join("; "));process.exit(1);}
    })' >&2
}

open_tickets() {
  curl -fsS -H 'x-orchestrator-request: 1' "$host/orchestrator/api/tickets?state=open&limit=1000" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const list=Array.isArray(j)?j:(j.tickets??j.items??[]);process.stdout.write(String(list.length))})'
}

release_validate() {
  dir="$1"; expected="${2:-}"
  [ -d "$dir/lib" ] || { echo "release lib missing: $dir/lib" >&2; return 1; }
  [ -f "$dir/meta.json" ] || { echo "release meta missing: $dir/meta.json" >&2; return 1; }
  if [ -z "$expected" ]; then
    expected=$(basename "$dir")
    is_sha "$expected" || { echo "release directory is not a full SHA: $expected" >&2; return 1; }
  fi
  is_sha "$expected" || { echo "expected release SHA is invalid: $expected" >&2; return 1; }
  name="$expected"
  node -e '
    const fs=require("fs"); const [dir,name]=process.argv.slice(1);
    const meta=JSON.parse(fs.readFileSync(dir+"/meta.json","utf8"));
    const fail=m=>{console.error(m);process.exit(1)};
    if(meta.formatVersion!==1) fail("unsupported release meta format: "+meta.formatVersion);
    if(meta.pluginCommit!==name) fail("release meta pluginCommit does not match directory: "+meta.pluginCommit+" vs "+name);
    if(typeof meta.entrySha256!=="string"||!/^[0-9a-f]{64}$/.test(meta.entrySha256)) fail("invalid entrySha256 in release meta");
    if(typeof meta.hostVersion!=="string"||meta.hostVersion.trim()==="") fail("release meta is missing hostVersion");
  ' "$dir" "$name" || return 1
  actual=$(sha256_file "$dir/lib/index.mjs")
  expected=$(node -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync(process.argv[1]+"/meta.json","utf8")).entrySha256)' "$dir")
  [ "$actual" = "$expected" ] || { echo "release entry hash mismatch: $dir" >&2; return 1; }
}

set_pointer() {
  new_lib="$1"
  tmp="$hephi/.lib-new-$$"
  rm -f "$tmp"
  ln -s "$new_lib" "$tmp"
  node -e 'const fs=require("fs");fs.renameSync(process.argv[1],process.argv[2])' "$tmp" "$hephi/lib"
}

SNAP_ROOT=""
snapshot_existing_lib() {
  [ -L "$hephi/lib" ] && return 0
  [ -d "$hephi/lib" ] || return 0
  SNAP_ROOT="$releases/.migration-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$SNAP_ROOT"
  cp -R "$hephi/lib" "$SNAP_ROOT/lib"
  echo "snapshot existing lib: $SNAP_ROOT" >&2
}

acquire_lock() {
  lock="$releases/.publish.lock"
  waited=0
  mkdir -p "$releases"
  while ! mkdir "$lock" 2>/dev/null; do
    [ "$waited" -ge 60 ] && { echo "publish lock timeout: $lock" >&2; exit 1; }
    sleep 1; waited=$((waited+1))
  done
  trap 'rmdir "$lock" 2>/dev/null || true; rm -rf "${build_root:-}"' EXIT INT TERM
}

build_release() {
  sha="$1"
  is_sha "$sha" || { echo "target must be a full 40-char SHA: $sha" >&2; exit 2; }
  mkdir -p "$releases"
  acquire_lock
  [ -e "$releases/$sha" ] && { echo "release already exists and is immutable: $releases/$sha" >&2; exit 1; }
  build_root=$(mktemp -d "$releases/.build-$sha-XXXXXX")
  git -C "$repo" archive "$sha" | tar -x -C "$build_root" || { echo "cannot archive commit $sha" >&2; exit 1; }
  [ -d "$build_root/hephi" ] || { echo "archived source has no hephi directory" >&2; exit 1; }
  ( cd "$build_root/hephi" && HEPHI_BUILD_COMMIT="$sha" pnpm install --frozen-lockfile && HEPHI_BUILD_COMMIT="$sha" pnpm check ) || { echo "build failed for $sha" >&2; exit 1; }
  [ -f "$build_root/hephi/lib/index.mjs" ] || { echo "build produced no lib/index.mjs" >&2; exit 1; }
  incoming="$releases/.incoming-$sha-$$"
  rm -rf "$incoming"
  mkdir -p "$incoming"
  cp -R "$build_root/hephi/lib" "$incoming/lib"
  entry=$(sha256_file "$incoming/lib/index.mjs")
  tree=$(git -C "$repo" rev-parse "$sha^{tree}")
  node -e '
    const fs=require("fs"); const [dir,sha,tree,entry,hostVersion]=process.argv.slice(1);
    fs.writeFileSync(dir+"/meta.json", JSON.stringify({formatVersion:1, pluginCommit:sha, sourceTree:tree, entrySha256:entry, builtAt:new Date().toISOString(), buildCommand:"pnpm install --frozen-lockfile && pnpm check", hostVersion, source:"git-archive"}, null, 2)+"\n");
  ' "$incoming" "$sha" "$tree" "$entry" "$host_version"
  release_validate "$incoming" "$sha" || { rm -rf "$incoming"; echo "incoming release failed validation" >&2; exit 1; }
  mv "$incoming" "$releases/$sha"
  rm -rf "$build_root"
}

restart_instance() {
  pid=$(cat "$instance/host.pid")
  kill -TERM "$pid" 2>/dev/null || true
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    [ "$waited" -ge "$timeout" ] && { echo "instance did not stop within ${timeout}s" >&2; return 1; }
    sleep 1; waited=$((waited+1))
  done
  nohup "$instance/start.sh" >> "$instance/logs/host.log" 2>&1 &
  echo $! > "$instance/host.pid"
  waited=0
  while :; do
    if state=$(read_state 2>/dev/null); then
      if health_ok "$state" 2>/dev/null; then HEALTH_STATE="$state"; return 0; fi
    fi
    [ "$waited" -ge "$timeout" ] && { echo "instance did not reach full health within ${timeout}s" >&2; return 1; }
    sleep 1; waited=$((waited+1))
  done
}

record() {
  kind="$1"; action="$2"; result="$3"
  shift 3
  file="$instance/logs/$kind-$(date -u +%Y%m%dT%H%M%SZ).json"
  node -e '
    const fs=require("fs"); const [file,action,result,hostVersion,...pairs]=process.argv.slice(1);
    const extra={}; for(let i=0;i+1<pairs.length;i+=2) extra[pairs[i]]=pairs[i+1];
    fs.writeFileSync(file, JSON.stringify({at:new Date().toISOString(), action, result, hostVersion, paused:true, ...extra}, null, 2)+"\n");
  ' "$file" "$action" "$result" "$host_version" "$@"
  echo "record: $file"
}

current_pointer_sha() {
  [ -L "$hephi/lib" ] || return 1
  release_sha "$(readlink "$hephi/lib")"
}

fail_keep_paused() {
  echo "$1" >&2
  exit 1
}

# ---- main ----
mkdir -p "$releases" "$instance/logs"
state=$(read_state) || fail_keep_paused "host state is unreadable: $host"
paused=$(printf '%s' "$state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.paused))})')
[ "$paused" = "true" ] || fail_keep_paused "host is not paused; pause and drain before deploying (P8)"
drain_ok "$state" || fail_keep_paused "drain check failed; refusing to upgrade"
count=$(open_tickets) || fail_keep_paused "cannot read open tickets; refusing to upgrade"
[ "$count" = "0" ] || fail_keep_paused "there are $count open Tickets; finish them before upgrading (no bypass)"

# 解析 target：未指定时取仓库 HEAD。
if [ -z "$target" ]; then target=$(git -C "$repo" rev-parse HEAD); fi
is_sha "$target" || fail_keep_paused "target must be a full 40-char SHA: $target"

pointer_before=$(readlink "$hephi/lib" 2>/dev/null || echo "")
current=$(current_pointer_sha 2>/dev/null || true)

# 已载入的 release 视为不可变：重复发布同一 SHA 是空操作，直接拒绝且不碰 release/不重启。
if [ "$rollback" != "yes" ] && [ -n "$current" ] && [ "$target" = "$current" ]; then
  fail_keep_paused "release $target is already loaded and immutable; nothing to deploy"
fi

if [ "$rollback" = "yes" ]; then
  [ -n "$previous" ] && [ -n "$target" ] || fail_keep_paused "--rollback needs an explicit --target release"
  release_validate "$releases/$target" || fail_keep_paused "rollback target release is invalid: $target"
  [ -n "$current" ] && release_validate "$releases/$current" || true
  snapshot_existing_lib
  set_pointer "$releases/$target/lib"
  started_ok="no"
  if restart_instance; then started_ok="yes"; fi
  if [ "$started_ok" = "no" ]; then
    if [ -n "$current" ] && [ -d "$releases/$current/lib" ]; then
      set_pointer "$releases/$current/lib"
      if ! restart_instance; then
        record rollback rollback failed-twice target "$target" previous "$current" pointerBefore "$pointer_before" health "not-checked"
        fail_keep_paused "rollback failed twice; host kept paused and needs manual takeover"
      fi
    fi
    record rollback rollback failed-restored-previous target "$target" previous "$current" pointerBefore "$pointer_before" health "not-checked"
    fail_keep_paused "rollback target failed health; previous build restored and host kept paused"
  fi
  record rollback rollback ok target "$target" previous "$current" pointerBefore "$pointer_before" pointerAfter "$(readlink "$hephi/lib")" health all-required-ready
  echo "rollback complete; host remains paused, verify loaded build then resume via API"
  exit 0
fi

# 构建或复用不可变 release。
if [ -d "$releases/$target/lib" ]; then
  release_validate "$releases/$target" || fail_keep_paused "target release is invalid: $target"
else
  build_release "$target"
  release_validate "$releases/$target" || fail_keep_paused "new release failed validation: $target"
fi

if [ "$dry_run" = "yes" ]; then
  echo "dry-run: preconditions, drain and release validation passed for $target; no switch, no restart"
  exit 0
fi

[ -n "$previous" ] || previous="$current"
if [ -n "$previous" ]; then release_validate "$releases/$previous" || fail_keep_paused "previous release is invalid: $previous"; fi

snapshot_existing_lib
if [ -z "$previous" ] && [ -z "$SNAP_ROOT" ]; then
  echo "first install: no previous release and no existing lib; a failed switch will keep the host paused" >&2
fi
set_pointer "$releases/$target/lib"
if restart_instance; then
  record deploy deploy ok target "$target" previous "$previous" pointerBefore "$pointer_before" pointerAfter "$(readlink "$hephi/lib")" health all-required-ready loadedCommitReadback unverified
  echo "deploy complete; host remains paused; loaded commit readback is unavailable (disk hash only)"
  exit 0
fi

# 切换后失败：自动恢复 previous（或首次安装的旧 lib 快照）并全量健康检查。
restore_target=""
if [ -n "$previous" ]; then restore_target="$releases/$previous/lib"
elif [ -n "$SNAP_ROOT" ]; then restore_target="$SNAP_ROOT/lib"; fi
if [ -z "$restore_target" ]; then
  record deploy deploy failed-no-previous target "$target" previous "" pointerBefore "$pointer_before" pointerAfter "$(readlink "$hephi/lib")" health "not-checked"
  fail_keep_paused "target failed after switch and no previous build exists; host kept paused"
fi
set_pointer "$restore_target"
if restart_instance; then
  record deploy deploy failed-restored-previous target "$target" previous "${previous:-snapshot}" pointerBefore "$pointer_before" pointerAfter "$(readlink "$hephi/lib")" health all-required-ready
  fail_keep_paused "target failed after switch; previous build restored and host kept paused"
fi
record deploy deploy failed-twice target "$target" previous "${previous:-snapshot}" pointerBefore "$pointer_before" health "not-checked"
fail_keep_paused "target and automatic recovery both failed; host kept paused with both errors recorded"
