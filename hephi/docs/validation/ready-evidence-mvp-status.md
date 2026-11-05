> 历史记录：针对删减前的 45b2a4a/a10d96f，不代表当前实现。当前范围见 docs/validation/ready-evidence-lean.md。

# Ready evidence MVP status

Date: 2026-11-04
Branch: `codex/ready-evidence-mvp`
Baseline: `7bd6fe0`
Starting HEAD: `035c240` (caller added the verified DSH seam notes after `a08b1eb`)
Worktree: `/Users/USER/Documents/ChatGPT/现代软件开发/hephi-ready-evidence-mvp`

This is an implementation fixture validation, not a real Issue end-to-end run.
No deployment, restart, push, merge, Issue/PR creation, business-repository
change, or use of an existing production Ticket contract was performed.

## Review findings

Source record: `docs/validation/ready-evidence-mvp-review-notes.md` (11 items).

| # | Original failure | Resolution in this worktree | Focused regression |
| --- | --- | --- | --- |
| 1 | JUnit `errors` could pass; a targetless pass could ignore all skips. | `check-evaluate` rejects any `errors>0` or `skipped>0` before pass/reproduce evaluation. | `tests/verification/check-evaluate.test.ts` |
| 2 | Reproduction only excluded a blacklist; `message` could hide a `ModuleNotFoundError` in the XML body. | Reproduction requires a frozen `expectedFailure` (`type` and/or `messageIncludes`); the parser keeps both `message` and element body; environmental failures still block. | `tests/verification/junit.test.ts`, `tests/verification/check-evaluate.test.ts`, `tests/contracts/checks.test.ts` |
| 3 | New contracts still required legacy forward/reverse commands. | Both commands are optional and omitted from new contracts; only historical contracts retain them and their original hash. New preparation requires explicit `verification` JSON. | `tests/contracts/checks.test.ts`, `tests/control/activation.test.ts` |
| 4 | `parser=exit` could claim a business test. | Checks now declare `kind: "build"` or `kind: "test"`; build is exit-only, test requires JUnit XML and executed cases. | `tests/contracts/checks.test.ts`, `tests/verification/check-evaluate.test.ts` |
| 5 | Executor identity was a label, not a build identity. | Runs record a fixed-at-module-load executor identity; bundle mode hashes the executing bundle, source mode hashes the complete executor source manifest; ready recomputes it. | `tests/control/executor-identity.test.ts`, `tests/control/evidence-verifier.test.ts` |
| 6 | Promoted Job lost the contract deadline/outer abort after `tools.execute` returned; a single 30s wait was treated as timeout. | Deadline and abort listener stay active for the whole lifecycle; `settleJob` polls across remaining-time windows until terminal or deadline; timeout/cancel kills and requires confirmation. | `tests/control/native-bash.test.ts` |
| 7 | Test-injected native runner could produce evidence ready accepted as production. | Records carry `executor.source: "native" | "diagnostic"`; ready rejects diagnostic/fixture evidence. Wiring tests use the default `ctx.tools.execute` path with a fake host result, not the injection seam. | `tests/control/evidence-verifier.test.ts`, `tests/control/check-control.test.ts`, `tests/control/check-runner.test.ts` |
| 8 | Ready did not require ticket/session/outer-inner call identity. | Ready checks `ticketId`, check id, native Session, outer/inner/root call ids, executor tool and build format before accepting evidence. | `tests/control/evidence-verifier.test.ts` |
| 9 | Only direct child Agents were audited; parent background Jobs were ambiguous. | Admission walks the whole descendant tree and each descendant's native Jobs. Parent-Session background Jobs are intentionally not inspected or killed; preview services do not block, and this is documented as a limitation, not absolute isolation. | `tests/control/check-control.test.ts` |
| 10 | Identity was re-read from disk per check; a rebuilt bundle could be mistaken for the loaded code. | `captureExecutorIdentity` runs at module load; source and bundle identities are explicit; disk replacement does not change the captured object and ready rejects the changed artifact. | `tests/control/executor-identity.test.ts`, `tests/control/evidence-verifier.test.ts` |
| 11 | Unconfirmed termination lived only in memory and a remount could start over. | The blocked run record persists `fault.execution-unconfirmed` with the native Job id. A remount verifies that exact Job: terminal resolves the fact and permits a new run; missing/running/unknown keeps checks and ready closed and requires manual disposition. Ready scans all old unresolved facts, even if a newer run passed. | `tests/control/check-control.test.ts`, `tests/control/evidence-verifier.test.ts` |
| 12 | Bundle capture used a manifest hash while bundle verification used the module file hash, so real bundles would always be rejected. | Bundle capture and verification now both hash the actual executing bundle; the compiled host fixture loads the built `lib` artifact, runs `hephi_check`, reads the resulting evidence through the compiled ready verifier, and then appends to the loaded bundle to prove ready rejects the replaced module. | `scripts/check-stage-host.mjs`, `docs/validation/2026-11-04-ready-evidence-mvp-build-host-final.log`, `tests/control/executor-identity.test.ts` |
| 13 | `runCheck` generated one inner call id but `executeNativeBash` generated another. | The runner generates the id once and passes it to the native executor; the test asserts the actual `tools.execute` call id equals the run record's `executor.innerCallId`. | `tests/control/check-runner.test.ts` |
| 14 | A crash could leave `status=running` without a fault; a new run could cover it. | Check entry and ready reject every `status=running` record. If the running record has a native Job id, check entry confirms its terminal state and marks the old run blocked/recovered; if missing/running/unknown, it persists a fault and blocks retries and ready. A newer pass cannot hide an old running record. | `tests/control/check-control.test.ts`, `tests/control/evidence-verifier.test.ts` |

## Actual test results

- `pnpm check`: exit 0, 27 test files, 197 tests passed, build succeeded.
- This round final log: `docs/validation/2026-11-04-ready-evidence-mvp-final3-check.log` (exit in `.exit`).
- Previous runs retained: `...final2-check.log` (27 files / 197 tests before the last persistence guard), `...final-check.log` (27 files / 193 tests) and `...check.log` (26 files / 185 tests).
- Compiled fixture: `node scripts/check-stage-host.mjs /Users/USER/hephi-isolated-b-20261102/node_modules` exit 0, log `docs/validation/2026-11-04-ready-evidence-mvp-build-host-final.log` (exit in `.exit`). It loads the built `lib` artifact through real rc.5 `ToolRuntime`, calls the compiled `hephi_check`, reads the saved evidence through compiled ready, and verifies the compiled module replacement rejection. The fixture registers a minimal local bash adapter (not the real DSH shell tool) and uses a temporary directory; it is not Worker/Issue E2E and not a deployment test.
- `git diff --check`: exit 0, empty log: `docs/validation/2026-11-04-ready-evidence-mvp-final3-diff-check.log` (exit in `.exit`).
- `pnpm typecheck` is part of `pnpm check`.

## Public API limitations and honest boundaries

- `JobView.detail` is a producer string, not a typed exit code. Only the documented `exit code: <integer>` form is accepted; any other detail blocks instead of guessing from output text.
- Nested `ctx.tools.execute` calls do not create their own Session events. Records store the outer `hephi_check` call id, inner bash call id and native Job id only; no event UUID is claimed.
- A parent-Session background Job cannot be reliably classified as a preview versus a write job through the public registry. Checks do not kill or mechanically block on such Jobs; they audit descendants and tracked in-flight calls instead. This is a known concurrency limitation.
- `hephi_check` is registered only for an activated Worker. In staged mode it is allowed only after every stage is completed and its checkpoint progress is reported; native mode has no stage requirement.
- New activation contracts require explicit `verification.checks`. Historical contracts without the field remain readable by their original hash, but ready refuses them with a new-contract instruction.
- The source test environment records a source-manifest executor identity. The compiled fixture exercises the bundle identity and replacement rejection, but no deployment or live runtime was performed; the fixture mixes rc.5 host packages with project runtime dependencies in a temporary directory.

## Unverified / not claimed

- Real Issue end-to-end through a live DSH/Super Agent Worker and a real Python/Dubbo project was not run.
- The fixture host is not a real DSH host; tests are interface/integration fixtures.
- No real new-contract Python/Dubbo task was prepared or executed.
- No deployment, reload, restart, remote Git operation, push, merge, or production Ticket mutation was performed.

## Commits

No new commit SHA was produced in this session: the DSH workspace-write sandbox denied
writing `.../hephi-superagent-plugin/.git/worktrees/hephi-ready-evidence-mvp/index.lock`,
and no approval channel was available for the exact Git command. Per the final
instruction, no further Git retry or escalation was attempted. `HEAD` remains
`035c240`; the reviewed working-tree changes are intact for the main assistant to
commit in two blocks: implementation/tests, then these validation documents.
