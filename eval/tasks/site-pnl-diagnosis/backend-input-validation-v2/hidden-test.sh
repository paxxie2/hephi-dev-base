#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast

src = open("backend/app/schemas.py", encoding="utf-8").read()
tree = ast.parse(src)
imports_config_dict = any(
    isinstance(node, ast.ImportFrom)
    and node.module == "pydantic"
    and any(alias.name == "ConfigDict" for alias in node.names)
    for node in tree.body
)
assert imports_config_dict, "schemas must import ConfigDict from pydantic"


def forbid_models():
    found = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        for stmt in node.body:
            if not isinstance(stmt, ast.Assign):
                continue
            if not any(isinstance(t, ast.Name) and t.id == "model_config" for t in stmt.targets):
                continue
            value = stmt.value
            if not (isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "ConfigDict"):
                continue
            for kw in value.keywords:
                if kw.arg == "extra" and isinstance(kw.value, ast.Constant) and kw.value.value == "forbid":
                    found.append(node.name)
    return found


models = forbid_models()
for name in ["CreateDiagnosisRequest", "ScenarioRequest"]:
    assert name in models, f"{name} must set model_config = ConfigDict(extra='forbid'), got {models}"
print("PASS: request bodies reject unknown fields")
PY
