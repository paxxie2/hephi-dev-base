#!/bin/sh
set -eu
python3 -B - <<'PY'
import ast, re

# 1) DiagnosisPage 新增 hasMore: bool 字段。
tree = ast.parse(open("backend/app/schemas.py", encoding="utf-8").read())
page = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "DiagnosisPage"][0]
fields = {
    n.target.id: n.annotation
    for n in page.body
    if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
}
assert "hasMore" in fields, f"DiagnosisPage must expose hasMore, got {sorted(fields)}"
assert isinstance(fields["hasMore"], ast.Name) and fields["hasMore"].id == "bool", ast.dump(fields["hasMore"])
for name in ["items", "total", "limit", "offset"]:
    assert name in fields, f"existing DiagnosisPage field {name} must be preserved"

# 2) 服务层按当前页实际条数计算 hasMore，并写入响应。
svc = open("backend/app/services/diagnoses.py", encoding="utf-8").read()
assert re.search(r"has_more\s*=\s*offset\s*\+\s*len\(items\)\s*<\s*total", svc), "get_diagnosis_page must compute has_more from offset/limit/items/total"
assert re.search(r"hasMore\s*=\s*has_more", svc), "DiagnosisPage must receive hasMore"
print("PASS: pagination hasMore metadata")
PY
