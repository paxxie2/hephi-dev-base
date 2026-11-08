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
recorded = []
stub = types.ModuleType("dotenv")
stub.load_dotenv = lambda path, override=False: recorded.append((str(path), override))
sys.modules["dotenv"] = stub
spec = importlib.util.spec_from_file_location("settings_dead_branches_v3", "backend/app/settings.py")
m = importlib.util.module_from_spec(spec)
sys.modules["settings_dead_branches_v3"] = m
spec.loader.exec_module(m)
os.environ["SITE_PNL_ENV_FILE"] = "  /tmp/spaced.env  "
recorded.clear()
m.Settings.from_env()
assert recorded and recorded[0][0] == "/tmp/spaced.env", f"SITE_PNL_ENV_FILE must be stripped before use, got {recorded}"
os.environ["SITE_PNL_ENV_FILE"] = "   "
recorded.clear()
m.Settings.from_env()
assert len(recorded) == 1 and recorded[0][0].endswith(".env") and "spaced" not in recorded[0][0], f"blank SITE_PNL_ENV_FILE must fall back to the repo .env, got {recorded}"
os.environ.pop("SITE_PNL_ENV_FILE", None)
os.environ.update({"SITE_PNL_HOST": "0.0.0.0", "SITE_PNL_PORT": "9123"})
settings = m.Settings.from_env()
assert settings.host == "0.0.0.0" and settings.port == 9123, (settings.host, settings.port)
assert settings.db_path.name == "site_pnl.db", settings.db_path
print("PASS: dead branch removed and SITE_PNL_ENV_FILE normalised to a path")
PY
