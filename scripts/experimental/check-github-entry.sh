#!/bin/sh
# P11 原生入口只读校验：Issue → PR → CI 是否同一 SHA；可选核对原生 Ticket 主表记录。
# 只核对已存在的链路；创建 Issue、启动 Worker 必须人工在真实宿主执行。
# 用法：./scripts/experimental/check-github-entry.sh --repo <owner/repo> --issue <n> --pr <n> [--state-db <sqlite>] [--ticket <id>]
set -eu

usage() {
  echo "usage: $0 --repo <owner/repo> --issue <n> --pr <n> [--state-db <sqlite>] [--ticket <id>]" >&2
  exit 2
}

repo=""
issue=""
pr=""
state_db=""
ticket=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) [ $# -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --issue) [ $# -ge 2 ] || usage; issue="$2"; shift 2 ;;
    --pr) [ $# -ge 2 ] || usage; pr="$2"; shift 2 ;;
    --state-db) [ $# -ge 2 ] || usage; state_db="$2"; shift 2 ;;
    --ticket) [ $# -ge 2 ] || usage; ticket="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done
[ -n "$repo" ] && [ -n "$issue" ] && [ -n "$pr" ] || usage

issue_json=$(gh issue view "$issue" -R "$repo" --json number,title,state,url 2>/dev/null) || { echo "读不到 Issue $repo#$issue" >&2; exit 2; }
pr_json=$(gh pr view "$pr" -R "$repo" --json number,state,headRefOid,headRefName,baseRefName,url 2>/dev/null) || { echo "读不到 PR $repo#$pr" >&2; exit 2; }
sha=$(printf '%s' "$pr_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.headRefOid || "")})')

runs_json=$(gh run list -R "$repo" --commit "$sha" --limit 10 --json databaseId,headSha,conclusion,workflowName 2>/dev/null || echo '[]')

ticket_json="null"
if [ -n "$ticket" ]; then
  [ -n "$state_db" ] || { echo "--ticket 需要同时给 --state-db" >&2; exit 2; }
  [ -f "$state_db" ] || { echo "state db 不存在：$state_db" >&2; exit 2; }
  ticket_json=$(sqlite3 -json "file:$state_db?immutable=1" "select id, value from ticket where id='$ticket';") || {
    echo "读取 Ticket 失败：$ticket" >&2
    exit 2
  }
fi

node -e 'const [repo, issue, pr, sha, issueJson, prJson, runsJson, ticketJson] = process.argv.slice(1); const problems = []; const issueData = JSON.parse(issueJson); const prData = JSON.parse(prJson); const runs = JSON.parse(runsJson || "[]"); if (!sha) problems.push("PR 没有 head SHA"); for (const run of runs) { if (run.headSha !== sha) problems.push(`CI run ${run.databaseId} headSha 与 PR head 不一致`); } if (runs.length === 0) problems.push("该提交没有任何 CI 运行"); let ticketData = null; if (ticketJson !== "null") { const rows = (ticketJson.trim() !== "") ? JSON.parse(ticketJson) : []; if (rows.length === 0) problems.push("Ticket 不存在"); else { const value = JSON.parse(rows[0].value); const scope = value.mandate?.basis?.scope ?? value.mandate?.scope ?? {}; ticketData = { id: rows[0].id, title: value.title, repository: scope.repository ?? null, issueNumber: scope.number ?? null, assignments: Array.isArray(value.assignments) ? value.assignments.length : 0, ended: value.ended ?? null }; if (ticketData.repository !== repo) problems.push(`Ticket repository 不符：${ticketData.repository}`); if (String(ticketData.issueNumber) !== String(issue)) problems.push(`Ticket issueNumber 不符：${ticketData.issueNumber}`); if (ticketData.assignments === 0) problems.push("Ticket 没有 Assignment"); if (!rows[0].value.includes(`/pull/${pr}`)) problems.push(`Ticket 未引用 PR #${pr}`); } } const out = { repo, issue: Number(issue), pr: Number(pr), prHead: sha, issueData: { number: issueData.number, state: issueData.state, title: issueData.title }, prData: { number: prData.number, state: prData.state, headRefName: prData.headRefName, baseRefName: prData.baseRefName }, ciRuns: runs.length, ticket: ticketData, problems, ok: problems.length === 0 }; console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1)' \
  "$repo" "$issue" "$pr" "$sha" "$issue_json" "$pr_json" "$runs_json" "$ticket_json"
