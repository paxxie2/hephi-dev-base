#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, sys
sys.path.insert(0, "backend")
import app.data.loader  # base lacks the restored data package
tree = ast.parse(open("backend/app/schemas.py", encoding="utf-8").read())
cls = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Health"][0]
fields = {n.target.id: n.value for n in cls.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
assert "service" in fields, "Health must expose the fixed service id field"
value = fields["service"]
assert isinstance(value, ast.Constant) and value.value == "site-pnl-diagnosis", ast.dump(value)
print("PASS: data sources restored and fixed health service id exposed")
PY
