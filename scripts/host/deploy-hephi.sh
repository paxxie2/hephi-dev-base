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
# 9. 首次从普通 lib 目录迁移是显式事务：先原子改名旧目录，再改名 symlink；第二步失败必须恢复旧目录。
# 10. 记录中的 paused／load／health 必须来自部署结束时的真实回读；不可读记为 unverified，不得硬编码 true。
# 11. rollback 只接受显式 --target（及显式 --previous），不得隐式取仓库 HEAD；恢复目标必须通过校验。
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
target_set="no"; previous_set="no"
releases=""; repo=""; hephi=""; timeout=120
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) [ $# -ge 2 ] || usage; instance="$2"; shift 2 ;;
    --host) [ $# -ge 2 ] || usage; host="$2"; shift 2 ;;
    --host-version) [ $# -ge 2 ] || usage; host_version="$2"; shift 2 ;;
    --target) [ $# -ge 2 ] || usage; target="$2"; target_set="yes"; shift 2 ;;
    --previous) [ $# -ge 2 ] || usage; previous="$2"; previous_set="yes"; shift 2 ;;
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
  ln -s "$new_lib" "$tmp" || { echo "cannot create temporary symlink: $tmp" >&2; return 1; }
  # 首次迁移：$hephi/lib 仍是普通目录，rename symlink 到目录会 EISDIR，必须先把旧目录原子改名备份。
  if [ -d "$hephi/lib" ] && [ ! -L "$hephi/lib" ]; then
    migration="$hephi/.migration-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mv "$hephi/lib" "$migration" || { rm -f "$tmp"; echo "cannot move plain lib directory aside: $hephi/lib" >&2; return 1; }
    MIGRATION_BACKUP="$migration"
    if ! node -e 'const fs=require("fs");fs.renameSync(process.argv[1],process.argv[2])' "$tmp" "$hephi/lib"; then
      rm -f "$tmp"
      if mv "$migration" "$hephi/lib" 2>/dev/null; then
        MIGRATION_RESTORE="restored"
        echo "pointer rename failed during plain-directory migration; old lib directory restored (verified mv back)" >&2
      else
        MIGRATION_RESTORE="failed"
        echo "pointer rename failed during plain-directory migration; old lib directory NOT restored; backup retained at $migration; manual takeover required" >&2
      fi
      return 1
    fi
    return 0
  fi
  node -e 'const fs=require("fs");fs.renameSync(process.argv[1],process.argv[2])' "$tmp" "$hephi/lib" \
    || { rm -f "$tmp"; echo "pointer rename failed: $tmp -> $hephi/lib" >&2; return 1; }
}

SNAP_ROOT=""; MIGRATION_BACKUP=""; MIGRATION_RESTORE=""
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

LAST_STATE=""; FAIL_STATE=""; FAIL_KIND=""; HEALTH_STATE=""
# 每次重启尝试都重置本阶段状态，禁止沿用上一阶段（target/restore）的字符串。
restart_instance() {
  LAST_STATE=""; FAIL_STATE=""; FAIL_KIND=""; HEALTH_STATE=""
  pid=$(cat "$instance/host.pid")
  kill -TERM "$pid" 2>/dev/null || true
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$timeout" ]; then
      FAIL_KIND="stop-timeout"; FAIL_STATE="$LAST_STATE"
      echo "instance did not stop within ${timeout}s" >&2
      return 1
    fi
    sleep 1; waited=$((waited+1))
  done
  nohup "$instance/start.sh" >> "$instance/logs/host.log" 2>&1 &
  echo $! > "$instance/host.pid"
  waited=0; got_state="no"
  while :; do
    if state=$(read_state 2>/dev/null); then
      LAST_STATE="$state"; got_state="yes"
      if health_ok "$state" 2>/dev/null; then HEALTH_STATE="$state"; return 0; fi
    fi
    if [ "$waited" -ge "$timeout" ]; then
      FAIL_STATE="$LAST_STATE"
      if [ "$got_state" = "yes" ]; then FAIL_KIND="health-timeout"; else FAIL_KIND="state-unreadable"; fi
      echo "instance did not reach full health within ${timeout}s (${FAIL_KIND})" >&2
      return 1
    fi
    sleep 1; waited=$((waited+1))
  done
}

# 记录真实宿主状态回读：paused/load/healthReadback 一律来自 read_state；读不到就写 unverified。
record() {
  kind="$1"; action="$2"; result="$3"
  shift 3
  file="$instance/logs/$kind-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
  state=$(read_state 2>/dev/null || true)
  node -e '
    const fs=require("fs"); const [file,action,result,hostVersion,state,...pairs]=process.argv.slice(1);
    const extra={}; for(let i=0;i+1<pairs.length;i+=2) extra[pairs[i]]=pairs[i+1];
    let paused="unverified", load="unverified", healthReadback="unverified";
    if(state){ try{const j=JSON.parse(state);
      if(typeof j.paused==="boolean") paused=j.paused;
      if(j.load&&typeof j.load==="object") load=j.load;
      if(j.health&&typeof j.health==="object") healthReadback=j.health;
    }catch(e){} }
    const rec={at:new Date().toISOString(), action, result, hostVersion, paused, load, healthReadback, ...extra};
    fs.writeFileSync(file, JSON.stringify(rec,null,2)+"\n");
  ' "$file" "$action" "$result" "$host_version" "$state" "$@"
  echo "record: $file"
}

current_pointer_sha() {
  [ -L "$hephi/lib" ] || return 1
  release_sha "$(readlink "$hephi/lib")"
}
pointer_after() { readlink "$hephi/lib" 2>/dev/null || echo ""; }

# 真实 paused 回读：读不到返回 1（调用方必须按 unverified/失败处理）。
paused_now() {
  s=$(read_state 2>/dev/null || true)
  [ -n "$s" ] || return 1
  printf '%s' "$s" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.paused))})'
}

fail_keep_paused() {
  echo "$1" >&2
  exit 1
}

# 失败出口统一回读 paused：yes/false/unverified。只有 confirmed true 才允许说 kept paused。
paused_flag() {
  p=$(paused_now 2>/dev/null || true)
  case "$p" in
    true) printf 'yes' ;;
    false) printf 'no' ;;
    *) printf 'unverified' ;;
  esac
}
fail_after_switch() {
  msg="$1"
  flag=$(paused_flag)
  case "$flag" in
    yes) fail_keep_paused "$msg; paused=true verified" ;;
    no) fail_keep_paused "$msg; host is NOT confirmed paused (paused=false); manual takeover required" ;;
    *) fail_keep_paused "$msg; paused state UNVERIFIED; manual takeover required" ;;
  esac
}

# ---- main ----
mkdir -p "$releases" "$instance/logs"

# rollback 语义：target／previous 只接受显式完整 SHA，必须在任何默认值/切换之前校验。
if [ "$rollback" = "yes" ]; then
  [ "$target_set" = "yes" ] || fail_keep_paused "--rollback needs an explicit --target release (no implicit HEAD default)"
  is_sha "$target" || fail_keep_paused "--rollback target must be a full 40-char SHA: $target"
  if [ "$previous_set" = "yes" ]; then
    is_sha "$previous" || fail_keep_paused "--rollback previous must be a full 40-char SHA: $previous"
  fi
fi

state=$(read_state) || fail_keep_paused "host state is unreadable: $host"
paused=$(printf '%s' "$state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.paused))})')
[ "$paused" = "true" ] || fail_keep_paused "host is not paused; pause and drain before deploying (P8)"
drain_ok "$state" || fail_keep_paused "drain check failed; refusing to upgrade"
count=$(open_tickets) || fail_keep_paused "cannot read open tickets; refusing to upgrade"
[ "$count" = "0" ] || fail_keep_paused "there are $count open Tickets; finish them before upgrading (no bypass)"

# 普通部署未指定 target 时才允许取仓库 HEAD；rollback 已在上方强制显式。
if [ -z "$target" ]; then target=$(git -C "$repo" rev-parse HEAD); fi
is_sha "$target" || fail_keep_paused "target must be a full 40-char SHA: $target"

pointer_before=$(pointer_after)
current=$(current_pointer_sha 2>/dev/null || true)

# current 是否通过校验必须单独保存：rollback 可以继续，但绝不允许把未通过校验的 current 当恢复目标。
current_valid="no"
if [ -n "$current" ]; then
  if release_validate "$releases/$current" >/dev/null 2>&1; then current_valid="yes"; fi
fi

# 已载入的 release 视为不可变：重复发布同一 SHA 是空操作，直接拒绝且不碰 release/不重启。
if [ "$rollback" != "yes" ] && [ -n "$current" ] && [ "$target" = "$current" ]; then
  fail_keep_paused "release $target is already loaded and immutable; nothing to deploy"
fi

if [ "$rollback" = "yes" ]; then
  release_validate "$releases/$target" || fail_keep_paused "rollback target release is invalid: $target"
  if [ "$previous_set" = "yes" ]; then
    release_validate "$releases/$previous" || fail_keep_paused "rollback previous release is invalid: $previous"
  fi
  snapshot_existing_lib
  if ! set_pointer "$releases/$target/lib"; then
    flag=$(paused_flag)
    record rollback rollback failed-pointer target "$target" previous "${previous:-$current}" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready migration "${MIGRATION_BACKUP:-none}" migrationRestore "${MIGRATION_RESTORE:-none}" keptPaused "$flag" error "pointer switch failed"
    if [ "${MIGRATION_RESTORE:-}" = "failed" ]; then
      fail_after_switch "rollback pointer switch failed and old lib directory restore FAILED; backup at ${MIGRATION_BACKUP}"
    fi
    fail_after_switch "rollback could not switch the loaded pointer"
  fi
  if restart_instance; then
    p=$(paused_now) || p=""
    if [ "$p" != "true" ]; then
      flag=$(paused_flag)
      record rollback rollback failed-not-paused target "$target" previous "${previous:-$current}" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health all-required-ready keptPaused "$flag" error "host did not report paused=true after rollback; manual takeover required"
      fail_keep_paused "host is not paused after rollback; manual takeover required"
    fi
    record rollback rollback ok target "$target" previous "${previous:-$current}" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health all-required-ready loadedCommitReadback unverified migration "${MIGRATION_BACKUP:-none}" keptPaused yes
    echo "rollback complete; host remains paused, verify loaded build then resume via API"
    exit 0
  fi
  # rollback 目标失败：用显式 previous（已校验）或通过校验的 current 恢复；两者都没有就记 failed-no-previous。
  target_fail_state="${FAIL_STATE:-unverified}"; target_fail_kind="${FAIL_KIND:-unknown}"
  restore_target=""; restore_kind=""
  if [ "$previous_set" = "yes" ]; then
    restore_target="$releases/$previous/lib"; restore_kind="previous"
  elif [ "$current_valid" = "yes" ]; then
    restore_target="$releases/$current/lib"; restore_kind="current"
  fi
  if [ -z "$restore_target" ]; then
    flag=$(paused_flag)
    record rollback rollback failed-no-previous target "$target" previous "${previous:-$current}" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" keptPaused "$flag" error "rollback target failed and no validated previous release exists"
    fail_after_switch "rollback target failed and no validated previous release exists"
  fi
  if ! set_pointer "$restore_target"; then
    flag=$(paused_flag)
    record rollback rollback failed-twice target "$target" previous "$restore_kind:$restore_target" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" restoreFailure "pointer restore to $restore_target failed" restoreFailureKind pointer-restore-failed keptPaused "$flag" error "rollback target failed and restoring pointer failed"
    fail_after_switch "rollback target failed and restoring the previous pointer failed"
  fi
  if restart_instance; then
    flag=$(paused_flag)
    record rollback rollback failed-restored-previous target "$target" previous "$restore_kind:$restore_target" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" restoreHealth all-required-ready keptPaused "$flag" error "rollback target failed; previous build restored"
    fail_after_switch "rollback target failed health; previous build restored"
  fi
  flag=$(paused_flag)
  record rollback rollback failed-twice target "$target" previous "$restore_kind:$restore_target" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" restoreFailure "${FAIL_STATE:-unverified}" restoreFailureKind "${FAIL_KIND:-unknown}" keptPaused "$flag" error "rollback target and automatic recovery both failed"
  fail_after_switch "rollback failed twice"
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
previous_valid="no"
if [ -n "$previous" ]; then previous_valid="yes"; fi

snapshot_existing_lib
if [ -z "$previous" ] && [ -z "$SNAP_ROOT" ]; then
  echo "first install: no previous release and no existing lib; a failed switch will keep the host paused" >&2
fi
if ! set_pointer "$releases/$target/lib"; then
  flag=$(paused_flag)
  record deploy deploy failed-pointer target "$target" previous "$previous" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready migration "${MIGRATION_BACKUP:-none}" migrationRestore "${MIGRATION_RESTORE:-none}" keptPaused "$flag" error "pointer switch failed"
  if [ "${MIGRATION_RESTORE:-}" = "failed" ]; then
    fail_after_switch "pointer switch failed and old lib directory restore FAILED; backup at ${MIGRATION_BACKUP}"
  fi
  fail_after_switch "could not switch the loaded pointer"
fi
if restart_instance; then
  p=$(paused_now) || p=""
  if [ "$p" != "true" ]; then
    flag=$(paused_flag)
    record deploy deploy failed-not-paused target "$target" previous "$previous" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health all-required-ready loadedCommitReadback unverified migration "${MIGRATION_BACKUP:-none}" keptPaused "$flag" error "host did not report paused=true after switch; manual takeover required"
    fail_keep_paused "host is not paused after switch; manual takeover required"
  fi
  record deploy deploy ok target "$target" previous "$previous" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health all-required-ready loadedCommitReadback unverified migration "${MIGRATION_BACKUP:-none}" keptPaused yes
  echo "deploy complete; host remains paused; loaded commit readback is unavailable (disk hash only)"
  exit 0
fi

# 切换后失败：统一错误路径——恢复 previous／快照，重启，全量健康复检，写记录，非零退出。
target_fail_state="${FAIL_STATE:-unverified}"; target_fail_kind="${FAIL_KIND:-unknown}"
restore_target=""; restore_kind=""
if [ "$previous_valid" = "yes" ]; then
  if release_validate "$releases/$previous" >/dev/null 2>&1; then
    restore_target="$releases/$previous/lib"; restore_kind="previous"
  fi
elif [ -n "$SNAP_ROOT" ] && [ -d "$SNAP_ROOT/lib" ]; then
  restore_target="$SNAP_ROOT/lib"; restore_kind="snapshot"
fi
if [ -z "$restore_target" ]; then
  flag=$(paused_flag)
  record deploy deploy failed-no-previous target "$target" previous "$previous" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready migration "${MIGRATION_BACKUP:-none}" migrationRestore "${MIGRATION_RESTORE:-none}" targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" keptPaused "$flag" error "target failed after switch and no validated previous build exists"
  fail_after_switch "target failed after switch and no validated previous build exists"
fi
if ! set_pointer "$restore_target"; then
  flag=$(paused_flag)
  record deploy deploy failed-twice target "$target" previous "$restore_kind:$restore_target" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready migration "${MIGRATION_BACKUP:-none}" migrationRestore "${MIGRATION_RESTORE:-none}" targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" restoreFailure "pointer restore to $restore_target failed" restoreFailureKind pointer-restore-failed keptPaused "$flag" error "target failed after switch and restoring previous pointer failed"
  fail_after_switch "target failed after switch and restoring the previous pointer failed"
fi
if restart_instance; then
  flag=$(paused_flag)
  record deploy deploy failed-restored-previous target "$target" previous "$restore_kind:$restore_target" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready migration "${MIGRATION_BACKUP:-none}" migrationRestore "${MIGRATION_RESTORE:-none}" targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" restoreHealth all-required-ready keptPaused "$flag" error "target failed after switch; previous build restored"
  fail_after_switch "target failed after switch; previous build restored"
fi
flag=$(paused_flag)
record deploy deploy failed-twice target "$target" previous "$restore_kind:$restore_target" pointerBefore "$pointer_before" pointerAfter "$(pointer_after)" health not-ready migration "${MIGRATION_BACKUP:-none}" migrationRestore "${MIGRATION_RESTORE:-none}" targetFailure "$target_fail_state" targetFailureKind "$target_fail_kind" restoreFailure "${FAIL_STATE:-unverified}" restoreFailureKind "${FAIL_KIND:-unknown}" keptPaused "$flag" error "target and automatic recovery both failed"
fail_after_switch "target and automatic recovery both failed"
