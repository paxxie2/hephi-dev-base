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
assert not any(isinstance(n, ast.If) for n in ast.walk(fn)), "from_env must call the dotenv entry point unconditionally"
calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_read_dotenv"]
assert len(calls) == 1, f"from_env must call _read_dotenv exactly once, found {len(calls)}"
reader = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_read_dotenv"][0]
assert [a.arg for a in reader.args.args] == ["env_file"], "the dotenv entry point must be parameterised as _read_dotenv(env_file)"
defaults = reader.args.defaults
assert len(defaults) == 1 and isinstance(defaults[0], ast.Constant) and defaults[0].value is None, "env_file must default to None"
recorded = []
stub = types.ModuleType("dotenv")
stub.load_dotenv = lambda path, override=False: recorded.append((str(path), override))
sys.modules["dotenv"] = stub
spec = importlib.util.spec_from_file_location("settings_dead_branches_v2", "backend/app/settings.py")
m = importlib.util.module_from_spec(spec)
sys.modules["settings_dead_branches_v2"] = m
spec.loader.exec_module(m)
os.environ.pop("SITE_PNL_ENV_FILE", None)
recorded.clear()
settings = m.Settings.from_env()
assert len(recorded) == 1 and str(recorded[0][0]).endswith(".env"), f"default load must only read the repo .env, got {recorded}"
assert settings.host == "127.0.0.1" and settings.port == 8000 and settings.db_path.name == "site_pnl.db", (settings.host, settings.port, settings.db_path)
recorded.clear()
os.environ["SITE_PNL_ENV_FILE"] = "/tmp/explicit.env"
m.Settings.from_env()
assert recorded[0][0] == "/tmp/explicit.env", f"explicit env file must load first, got {recorded}"
recorded.clear()
m._read_dotenv("/tmp/param.env")
assert recorded[0][0] == "/tmp/param.env", f"the parameterised entry point must honour its env_file argument, got {recorded}"
print("PASS: dead branch removed and the dotenv entry point parameterised without behavior change")
PY
