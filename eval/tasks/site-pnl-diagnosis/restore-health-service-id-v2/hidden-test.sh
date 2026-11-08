#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast
constants = ast.parse(open("backend/app/constants.py", encoding="utf-8").read())
values = {}
for node in constants.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            values[node.targets[0].id] = node.value.value
assert values.get("SERVICE_ID") == "site-pnl-diagnosis-api", f"constants.SERVICE_ID must be the fixed service id, got {values.get('SERVICE_ID')!r}"
schemas = ast.parse(open("backend/app/schemas.py", encoding="utf-8").read())
health = [n for n in schemas.body if isinstance(n, ast.ClassDef) and n.name == "Health"][0]
fields = {n.target.id: n for n in health.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
assert "serviceId" in fields, "Health must expose the serviceId field"
annotation = fields["serviceId"].annotation
assert isinstance(annotation, ast.Name) and annotation.id == "str", ast.dump(annotation)
main = open("backend/app/main.py", encoding="utf-8").read()
assert "SERVICE_ID" in main, "main.py must import and use the shared SERVICE_ID constant"
assert "serviceId=SERVICE_ID" in main, "Health must be built with serviceId=SERVICE_ID"
assert 'JSONResponse(status_code=503' in main, "the 503 branch must keep returning the same payload fields"
print("PASS: Health.serviceId comes from the shared SERVICE_ID constant on 200/503")
PY
