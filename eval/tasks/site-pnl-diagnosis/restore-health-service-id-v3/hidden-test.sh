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
assert values.get("SERVICE_ID") == "site-pnl-diagnosis", f"constants.SERVICE_ID must be the fixed service id, got {values.get('SERVICE_ID')!r}"
schemas = ast.parse(open("backend/app/schemas.py", encoding="utf-8").read())
service = [n for n in schemas.body if isinstance(n, ast.ClassDef) and n.name == "ServiceInfo"]
assert service, "schemas must define the ServiceInfo model"
service_fields = {n.target.id: n for n in service[0].body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
assert set(service_fields) == {"id", "version"}, service_fields.keys()
for name, node in service_fields.items():
    assert isinstance(node.annotation, ast.Name) and node.annotation.id == "str", (name, ast.dump(node.annotation))
health = [n for n in schemas.body if isinstance(n, ast.ClassDef) and n.name == "Health"][0]
health_fields = {n.target.id: n for n in health.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
assert "service" in health_fields, "Health must expose the structured service field"
service_annotation = health_fields["service"].annotation
assert isinstance(service_annotation, ast.Name) and service_annotation.id == "ServiceInfo", ast.dump(service_annotation)
main = open("backend/app/main.py", encoding="utf-8").read()
assert "ServiceInfo(" in main, "main.py must build the ServiceInfo value"
assert "SERVICE_ID" in main and "APP_VERSION" in main, "main.py must use SERVICE_ID and APP_VERSION"
assert "id=SERVICE_ID" in main and "version=APP_VERSION" in main, "ServiceInfo must be built from the shared constants"
assert 'JSONResponse(status_code=503' in main, "the 503 branch must keep returning the same payload fields"
print("PASS: Health exposes a structured ServiceInfo service descriptor on 200/503")
PY
