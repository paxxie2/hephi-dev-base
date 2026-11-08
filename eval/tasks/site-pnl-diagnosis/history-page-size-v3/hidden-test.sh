#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast

# 1) 路由层新增可选 siteId 查询参数（默认 None），并传给服务层。
api = open("backend/app/api/diagnoses.py", encoding="utf-8").read()
tree = ast.parse(api)
fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "list_diagnoses"][0]
args = [a.arg for a in fn.args.args]
assert "siteId" in args, f"list_diagnoses must accept siteId, got {args}"
defaults = dict(zip(args[len(args) - len(fn.args.defaults):], fn.args.defaults))
site_default = defaults.get("siteId")
assert isinstance(site_default, ast.Call), ast.dump(site_default)
assert isinstance(site_default.func, ast.Name) and site_default.func.id == "Query", ast.dump(site_default.func)
assert isinstance(site_default.args[0], ast.Constant) and site_default.args[0].value is None, "siteId must default to None"
assert "siteId" in api.split("get_diagnosis_page", 1)[1], "route must pass siteId to the service"

# 2) 服务层按 site_id 过滤（未提供时保持原行为）。
svc = open("backend/app/services/diagnoses.py", encoding="utf-8").read()
assert "site_id: str | None = None" in svc, "list_diagnoses/get_diagnosis_page must accept site_id"
assert svc.count("WHERE site_id = ?") == 2, "both count and page queries must filter by site_id"
assert "list_diagnoses(db_path, limit, offset, site_id)" in svc, "get_diagnosis_page must forward site_id"
print("PASS: optional siteId filter")
PY
