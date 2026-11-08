#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast

src = open("backend/app/main.py", encoding="utf-8").read()
tree = ast.parse(src)
routes = []
for node in ast.walk(tree):
    if not isinstance(node, ast.FunctionDef):
        continue
    for dec in node.decorator_list:
        if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr == "get":
            if dec.args and isinstance(dec.args[0], ast.Constant) and dec.args[0].value == "/api/health/live":
                routes.append(node)
assert len(routes) == 1, f"expected exactly one GET /api/health/live route, got {len(routes)}"
fn = routes[0]
fn_src = ast.get_source_segment(src, fn) or ""
assert "db_status" not in fn_src, "liveness must not touch the database"
assert '{"status": "ok"}' in fn_src or '{"status":"ok"}' in fn_src, "liveness must return status ok"
print("PASS: liveness endpoint")
PY
