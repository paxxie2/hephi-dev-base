#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, importlib.util, os, sys, types
src = open("backend/app/settings.py", encoding="utf-8").read()
tree = ast.parse(src)
cls = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Settings"][0]
fn = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "from_env"][0]
def norm(block):
    return ast.dump(ast.Module(body=block, type_ignores=[]))
dups = [n for n in ast.walk(fn) if isinstance(n, ast.If) and n.body and norm(n.body) == norm(n.orelse)]
assert not dups, "from_env still contains an if/else with identical branches"
stub = types.ModuleType("dotenv")
stub.load_dotenv = lambda *a, **k: None
sys.modules["dotenv"] = stub
spec = importlib.util.spec_from_file_location("settings", "backend/app/settings.py")
m = importlib.util.module_from_spec(spec)
sys.modules["settings"] = m
spec.loader.exec_module(m)
os.environ.update({"SITE_PNL_HOST": "0.0.0.0", "SITE_PNL_PORT": "9123", "SITE_PNL_LOAD_DOTENV": "1"})
s = m.Settings.from_env()
assert s.host == "0.0.0.0" and s.port == 9123, (s.host, s.port)
assert s.db_path.name == "site_pnl.db", s.db_path
assert s.deepseek_model
print("PASS: settings identical branches removed with preserved behavior")
PY
