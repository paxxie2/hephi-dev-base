#!/bin/sh
set -eu
python3 -B - <<'PY'
import os, subprocess, sys
sys.path.insert(0, "backend")
for path in ["backend/app/data/__init__.py", "backend/app/data/seed.py"]:
    assert os.path.isfile(path), f"missing restored source file {path}"
import app.data.seed as seed
assert callable(seed.seed_database), "seed_database must be callable"
result = subprocess.run(["git", "check-ignore", "backend/app/data/seed.py"], capture_output=True, text=True)
assert result.returncode == 1, "backend/app/data/seed.py must not be git-ignored: " + result.stdout
lines = [line.strip() for line in open(".gitignore", encoding="utf-8").read().splitlines()]
assert "data/" not in lines, "broad data/ ignore rule must be gone"
assert "*.db" not in lines, "global *.db rule must be narrowed to the root runtime data directory"
assert "/data/*.db" in lines, "runtime database must be ignored as /data/*.db"
assert "/data/*.db-wal" in lines and "/data/*.db-shm" in lines, "runtime database side files must stay ignored"
print("PASS: seed path restored with precise runtime database ignore rules")
PY
