#!/bin/sh
# P9 实验仓库最小权限自检（只读）。
# 只核对可安全读取项：身份、token scopes、仓库权限、分支保护状态。
# 越权负例（推 main、合并、改设置、改 Issue）必须人工执行并记录服务端响应；本脚本不尝试任何写操作。
# 用法：./scripts/experimental/check-github-permissions.sh --repo <owner/repo> [--branch main] [--expect-admin false]
set -eu

usage() {
  echo "usage: $0 --repo <owner/repo> [--branch main] [--expect-admin false]" >&2
  exit 2
}

repo=""
branch="main"
expect_admin="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) [ $# -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --branch) [ $# -ge 2 ] || usage; branch="$2"; shift 2 ;;
    --expect-admin) [ $# -ge 2 ] || usage; expect_admin="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done
[ -n "$repo" ] || usage
case "$repo" in */*) ;; *) echo "--repo 需要 owner/repo 形式" >&2; exit 2 ;; esac

login=$(gh api user --jq .login) || { echo "gh 未认证" >&2; exit 2; }
scopes=$(gh auth status --hostname github.com 2>&1 | sed -n 's/.*Token scopes: //p' | head -1)
perms=$(gh api "repos/$repo" --jq '.permissions') || { echo "无法读取仓库权限：$repo" >&2; exit 2; }
values=$(printf '%s' "$perms" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write([j.admin===true,j.push===true,j.maintain===true,j.pull===true].join(" "))})')
set -- $values
admin="$1"
push="$2"
maintain="$3"
pull="$4"

if gh api "repos/$repo/branches/$branch/protection" >/dev/null 2>&1; then
  protection="protected"
else
  protection="unprotected-or-unreadable"
fi
has_workflow_scope=no
case "$scopes" in *workflow*) has_workflow_scope=yes ;; esac

problems=""
[ "$pull" = "true" ] || problems="$problems 无 pull 权限；"
[ "$push" = "true" ] || problems="$problems 无 push 权限（无法推 agent/*）；"
if [ "$admin" = "true" ] && [ "$expect_admin" = "false" ]; then
  problems="$problems 当前凭据是该仓库管理员，不满足实验最小权限；"
fi
note=""
if [ "$admin" = "true" ] && [ "$expect_admin" = "true" ]; then
  note="管理员凭据仅用于配置，实验执行必须换最小权限身份"
fi

result=$(node -e 'const [repo,login,scopes,branch,protection,admin,push,maintain,pull,expectAdmin,problems,note,workflow] = process.argv.slice(1); console.log(JSON.stringify({repo,login,scopes,branch,protection,permissions:{admin:admin==="true",push:push==="true",maintain:maintain==="true",pull:pull==="true"},expectAdmin:expectAdmin==="true",hasWorkflowScope:workflow==="yes",note:note || null,problems:problems.split(";").map(s=>s.trim().replace(/[；;]+$/,'')).filter(Boolean)},null,2))' \
  "$repo" "$login" "$scopes" "$branch" "$protection" "$admin" "$push" "$maintain" "$pull" "$expect_admin" "$problems" "$note" "$has_workflow_scope")
echo "$result"
case "$problems" in *[![:space:]]*) echo "结论：未通过（见 problems）；越权负例仍需人工执行并记录服务端响应。" >&2; exit 1 ;; esac
echo "结论：只读检查通过；仍须人工执行越权负例（推 main、合并、改设置、改 Issue）并保留服务端拒绝证据。"
