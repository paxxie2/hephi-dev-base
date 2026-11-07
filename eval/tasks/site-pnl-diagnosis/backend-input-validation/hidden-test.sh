#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, importlib.util
spec = importlib.util.spec_from_file_location("vm", "backend/app/validation_messages.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
errors = [{"type": "missing", "loc": ("body", "kind")}]
out = m.chinese_field_errors(errors)
assert out.get("kind") and "必填" in out["kind"], out
def references(path):
    tree = ast.parse(open(path, encoding="utf-8").read())
    return "chinese_field_errors" in open(path, encoding="utf-8").read()
for path in ["backend/app/main.py", "backend/app/services/scenarios.py"]:
    assert references(path), f"{path} must reuse chinese_field_errors for field-level validation"
main = open("backend/app/main.py", encoding="utf-8").read()
assert "RequestValidationError" in main, "main must keep the request validation handler"
print("PASS: cross-module field-level validation reuse")
PY
