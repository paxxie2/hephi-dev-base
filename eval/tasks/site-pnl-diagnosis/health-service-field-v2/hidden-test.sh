#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast

src = open("backend/app/main.py", encoding="utf-8").read()
tree = ast.parse(src)
health = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "health"][0]
health_src = ast.get_source_segment(src, health) or ""
assert '"database unavailable"' in health_src, "503 detail must be the fixed public message"
assert 'detail=status["error"]' not in src, "internal db error text must not be exposed as detail"
for field in ["status", "db", "seeded", "dataVersion", "modelConfigured", "appVersion"]:
    assert field in health_src, f"existing health field {field} must be preserved"
assert "logger.warning" in health_src, "internal error should be logged instead of exposed"
print("PASS: fixed 503 detail without leaking internals")
PY
