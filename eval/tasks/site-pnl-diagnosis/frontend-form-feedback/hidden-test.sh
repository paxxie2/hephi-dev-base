#!/bin/sh
set -eu
python3 -B - <<'PY'
import os, sys
sys.path.insert(0, "backend")
import app.data.loader as loader  # base lacks the restored data source package
assert callable(loader.load_sites)
lines = open(".gitignore", encoding="utf-8").read().splitlines()
assert "/data/" in lines and "data/" not in lines, "root .gitignore must scope runtime data to /data/"
section = open("web/src/features/scenarios/ScenarioSection.tsx", encoding="utf-8").read()
for needle in ["rent-range-hint", "share-range-hint", "recovery-bps-range-hint"]:
    assert needle in section, f"missing range hint test id {needle}"
assert "单位：元" in section, "rent input must show the yuan unit"
assert "0%—100%" in section, "percentage inputs must show the legal range"
assert os.path.isfile("web/e2e/08-scenario-validation.spec.ts"), "scenario validation e2e spec missing"
print("PASS: scenario form feedback and baseline data restore")
PY
