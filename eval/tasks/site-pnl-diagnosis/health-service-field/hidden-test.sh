#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast
tree = ast.parse(open("backend/app/schemas.py", encoding="utf-8").read())
cls = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Health"][0]
fields = {n.target.id: n.value for n in cls.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
assert "service" in fields, "Health must expose the fixed service field"
value = fields["service"]
assert isinstance(value, ast.Constant) and value.value == "site-pnl-diagnosis", ast.dump(value)
for name in ["status", "db", "seeded"]:
    assert name in fields, f"existing Health field {name} must be preserved"
readme = open("README.md", encoding="utf-8").read()
assert "site-pnl-diagnosis" in readme, "README must document the fixed service id"
print("PASS: fixed service field added to health responses")
PY
