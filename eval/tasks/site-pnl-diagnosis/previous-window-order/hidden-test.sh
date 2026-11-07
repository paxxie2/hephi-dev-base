#!/bin/sh
set -eu
python3 -B - <<'PYTEST'
import importlib.util
spec = importlib.util.spec_from_file_location("money", "backend/app/domain/money.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.previous_window("2024-03-01", "2024-03-02") == ("2024-02-28", "2024-02-29")
assert m.previous_window("2025-01-01", "2025-01-01") == ("2024-12-31", "2024-12-31")
try:
    m.previous_window("2024-03-02", "2024-03-01")
except ValueError:
    pass
else:
    raise AssertionError("reversed date window must raise ValueError")
print("previous_window boundary checks PASS")
PYTEST
