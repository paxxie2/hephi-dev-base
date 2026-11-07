#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, importlib.util
src = open("backend/app/domain/money.py", encoding="utf-8").read()
tree = ast.parse(src)
funcs = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
assert "_parse_window" in funcs, "missing helper _parse_window"
assert "_window_day_count" in funcs, "missing helper _window_day_count"
def calls(name):
    return [c.func.id for c in ast.walk(funcs[name]) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)]
assert "_parse_window" in calls("date_range") and "_window_day_count" in calls("date_range"), "date_range must reuse the extracted helpers"
assert "_parse_window" in calls("previous_window") and "_window_day_count" in calls("previous_window"), "previous_window must reuse the extracted helpers"
spec = importlib.util.spec_from_file_location("money", "backend/app/domain/money.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
assert m.date_range("2024-03-01", "2024-03-03") == ["2024-03-01", "2024-03-02", "2024-03-03"]
assert m.date_range("2024-03-03", "2024-03-01") == []
assert m.previous_window("2024-03-01", "2024-03-02") == ("2024-02-28", "2024-02-29")
assert m.previous_window("2025-01-01", "2025-01-01") == ("2024-12-31", "2024-12-31")
try:
    m.parse_date("not-a-date")
except ValueError:
    pass
else:
    raise AssertionError("invalid date must raise ValueError")
print("PASS: money window helpers extracted with preserved behavior")
PY
