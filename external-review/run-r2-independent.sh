#!/bin/bash
set -euo pipefail

ROOT="/Users/zm/Documents/kimi/tasks/2026-11-07/02-08-22-85063b14/external-review"
COMMIT="17d3827d3a73d3afb7a3b8de130d1615bd351769"
GIT_COPY="$ROOT/r2-independent-git"
ARCHIVE_COPY="$ROOT/r2-independent-archive"
EVIDENCE="$ROOT/evidence/pr20-independent/r2"
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"

rm -rf "$GIT_COPY" "$ARCHIVE_COPY"
mkdir -p "$GIT_COPY" "$ARCHIVE_COPY" "$EVIDENCE"

git clone --quiet --no-hardlinks "$ROOT/hephi-review" "$GIT_COPY"
# The no-hardlinks local clone already contains the fetched PR object; avoid network dependence.
git -C "$GIT_COPY" cat-file -e "$COMMIT^{commit}"
git -C "$GIT_COPY" checkout --quiet --detach "$COMMIT"
git -C "$GIT_COPY" archive "$COMMIT" | tar -x -C "$ARCHIVE_COPY"

printf 'node=%s\npnpm=%s\ncommit=%s\n' "$(node --version)" "$(pnpm --version)" "$COMMIT" | tee "$EVIDENCE/environment.log"

pnpm --dir "$GIT_COPY/hephi" install --frozen-lockfile > "$EVIDENCE/install-git.log" 2>&1
pnpm --dir "$ARCHIVE_COPY/hephi" install --frozen-lockfile > "$EVIDENCE/install-archive.log" 2>&1

run_case() {
  local name="$1"
  local expected="$2"
  local cwd="$3"
  shift 3
  set +e
  (cd "$cwd" && "$@") > "$EVIDENCE/$name.log" 2>&1
  local actual=$?
  set -e
  printf '%s exit=%s expected=%s\n' "$name" "$actual" "$expected" | tee "$EVIDENCE/$name.status"
  if [ "$actual" -ne "$expected" ]; then
    cat "$EVIDENCE/$name.log"
    return 1
  fi
}

run_case clean-git 0 "$GIT_COPY/hephi" env -u HEPHI_BUILD_COMMIT pnpm build
printf '\nuntracked dirty probe\n' > "$GIT_COPY/hephi/DIRTY_PROBE.txt"
run_case dirty-git-with-override 1 "$GIT_COPY/hephi" env HEPHI_BUILD_COMMIT="$COMMIT" pnpm build
rm "$GIT_COPY/hephi/DIRTY_PROBE.txt"
run_case archive-no-commit 1 "$ARCHIVE_COPY/hephi" env -u HEPHI_BUILD_COMMIT pnpm build
run_case archive-full-commit 0 "$ARCHIVE_COPY/hephi" env HEPHI_BUILD_COMMIT="$COMMIT" pnpm build

node --input-type=module -e "import('$ARCHIVE_COPY/hephi/lib/index.mjs').then((m) => { const value = m.describePlugin(); console.log(JSON.stringify(value)); if (value.commit !== '$COMMIT') process.exit(1) })" > "$EVIDENCE/archive-describe-plugin.log" 2>&1
cat "$EVIDENCE/archive-describe-plugin.log"

if [ -e "$ARCHIVE_COPY/.git" ]; then
  echo 'archive unexpectedly contains .git' >&2
  exit 1
fi

echo 'R2 independent checks passed'
