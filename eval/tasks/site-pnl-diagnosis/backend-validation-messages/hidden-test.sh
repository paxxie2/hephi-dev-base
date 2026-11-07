#!/bin/sh
set -eu
python3 -B - <<'PY'
import importlib.util
spec = importlib.util.spec_from_file_location("vm", "backend/app/validation_messages.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
errors = [
    {"type": "missing", "loc": ("body", "monthlyRentCents")},
    {"type": "int_type", "loc": ("body", "shareBps")},
    {"type": "float_finite", "loc": ("body", "monthlyRentCents")},
    {"type": "greater_than_equal", "loc": ("body", "recoveryBps"), "ctx": {"ge": 0}},
    {"type": "less_than_equal", "loc": ("body", "repairCostCents"), "ctx": {"le": 10000}},
    {"type": "extra_forbidden", "loc": ("body", "bogus")},
    {"type": "literal_error", "loc": ("body", "kind"), "ctx": {"expected": "'rent' or 'share'"}},
]
out = m.chinese_field_errors(errors)
expected_fields = {"monthlyRentCents", "shareBps", "recoveryBps", "repairCostCents", "bogus", "kind"}
assert expected_fields <= set(out), out
for field in expected_fields:
    assert any("\u4e00" <= ch <= "\u9fff" for ch in out[field]), (field, out[field])
assert "必填" in out["monthlyRentCents"], out["monthlyRentCents"]
assert "不支持字段" in out["bogus"], out["bogus"]
assert "0" in out["recoveryBps"], out["recoveryBps"]
assert "10000" in out["repairCostCents"], out["repairCostCents"]
assert "整数" in out["shareBps"], out["shareBps"]
print("PASS: Chinese field-level validation messages")
PY
