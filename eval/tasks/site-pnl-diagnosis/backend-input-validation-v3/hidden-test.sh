#!/bin/sh
set -eu
python3 -B - <<'PY'
src = open("backend/app/main.py", encoding="utf-8").read()
assert '415: "UNSUPPORTED_MEDIA_TYPE"' in src, "415 must map to UNSUPPORTED_MEDIA_TYPE"
assert '404: "NOT_FOUND"' in src, "existing 404 mapping must be preserved"
assert '405: "METHOD_NOT_ALLOWED"' in src, "existing 405 mapping must be preserved"
assert "handle_http_error" in src, "StarletteHTTPException handler must be preserved"
assert '"HTTP_ERROR"' in src, "unknown HTTP statuses must keep the generic fallback"
print("PASS: unified 415 error code")
PY
