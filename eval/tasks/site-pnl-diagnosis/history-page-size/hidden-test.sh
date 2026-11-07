#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, re
api = open("backend/app/api/diagnoses.py", encoding="utf-8").read()
tree = ast.parse(api)
fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "list_diagnoses"][0]
query_defaults = []
for node in ast.walk(fn):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Query":
        first = node.args[0] if node.args else None
        if isinstance(first, ast.Constant):
            query_defaults.append(first.value)
assert 10 in query_defaults, f"GET /api/diagnoses default limit must be 10, got {query_defaults}"
assert 20 not in query_defaults, "old default limit 20 must be gone"
web = open("web/src/App.tsx", encoding="utf-8").read()
assert re.search(r"HISTORY_PAGE_SIZE\s*=\s*10\b", web), "web HISTORY_PAGE_SIZE must be 10"
view = open("web/src/features/history/HistoryView.tsx", encoding="utf-8").read()
assert re.search(r"\?\?\s*10\b", view), "HistoryView fallback page size must be 10"
assert "history-page-indicator" in view, "current page indicator test id missing"
print("PASS: diagnosis history defaults to 10 items per page")
PY
