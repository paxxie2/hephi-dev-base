#!/bin/sh
set -eu
python3 -B - <<'PY'
import os, subprocess, sys
sys.path.insert(0, "backend")
for path in ["backend/app/data/__init__.py", "backend/app/data/loader.py", "backend/app/data/seed.py"]:
    assert os.path.isfile(path), f"missing restored source file {path}"
import app.data.loader as loader
import app.data.seed as seed
assert callable(loader.load_sites) and callable(loader.dataset_bounds)
assert callable(seed.seed_database)
result = subprocess.run(["git", "check-ignore", "backend/app/data/loader.py"], capture_output=True, text=True)
assert result.returncode == 1, "backend/app/data/loader.py must not be git-ignored: " + result.stdout
lines = open(".gitignore", encoding="utf-8").read().splitlines()
assert "/data/" in lines, "root runtime data must be scoped as /data/"
assert "data/" not in lines, "broad data/ ignore rule must be removed"
print("PASS: restored app.data package is tracked and importable")
PY
