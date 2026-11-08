#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, os, subprocess, sys
sys.path.insert(0, "backend")
for path in ["backend/app/data/__init__.py", "backend/app/data/loader.py"]:
    assert os.path.isfile(path), f"missing restored source file {path}"
import app.data.loader as loader
assert callable(loader.load_sites) and callable(loader.get_site_info) and callable(loader.load_site_data)
tree = ast.parse(open("backend/app/data/loader.py", encoding="utf-8").read())
get_site = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "get_site_info"][0]
assert any(isinstance(n, ast.IfExp) for n in ast.walk(get_site)), "get_site_info must keep its missing-row None branch"
load_site = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "load_site_data"][0]
raises = [n for n in ast.walk(load_site) if isinstance(n, ast.Raise) and isinstance(n.exc, ast.Call)
          and isinstance(n.exc.func, ast.Name) and n.exc.func.id == "ValueError"]
assert raises, "load_site_data must keep the unknown-site ValueError branch"
result = subprocess.run(["git", "check-ignore", "backend/app/data/loader.py"], capture_output=True, text=True)
assert result.returncode == 1, "backend/app/data/loader.py must not be git-ignored: " + result.stdout
lines = [line.strip() for line in open(".gitignore", encoding="utf-8").read().splitlines()]
assert "data/" in lines, "this variant keeps the broad runtime data/ rule"
assert "!/backend/app/data/" in lines, "negation rule must re-include the source package directory"
assert "!/backend/app/data/**/*.py" in lines, "negation rule must re-include the source package files"
print("PASS: loader read path restored through gitignore negation rules")
PY
