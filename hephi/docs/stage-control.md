# Optional stage control

This implementation stays in the HEPHI plugin. It registers `hephi_stage` directly in an activated Worker's scope, so Super Agent's inherited tool allow-list does not need modification. Ordinary tasks never call `plan`; their existing tools and ready verifier remain unchanged.

## Current execution modes (2026-11-04)

HEPHI activation now selects one of two modes, bound at Worker mount:

- `native` (default, and the meaning of every historical contract without an `executionMode` field): use native DSH planning and Agent Team/subagent tools. No `hephi_stage`, stage prompt or stage state is installed, and an old `execution-plan.json` is not read as evidence. The cumulative ready verification is unchanged.
- `staged` (explicit `executionMode: "staged"` in the activation contract): use the serial stage cycle below. From mount through the final report, implementation delegation is forbidden for the whole cycle, including before the first plan, between stages, during checks, after recovery and during push/PR. This covers the host's `subagent`, `agent-team` (`spawn_teammate`/`send_message`/`team_task_*`) and workflow entries. Read-only investigation, explicit `interrupt_agent`/`wait_agent`, `blocked`/`progress` reports and stage progress remain available. Before a stage plan, implementation and direct `ready` are closed.

A loaded subagent is treated as active only when its public `Agent.status` is `running`, or when it is `idle` but still owns a `running`/`stopping` Job. A loaded `idle` subagent whose Jobs are all terminal is not a blocker. Unknown Agent or Job states fail closed. `blocked`/`progress` reports must still reach the host when stage control cannot load; they never advance a faulted, violated or otherwise closed stage.

## Protocol

- `plan`: reason plus `planJson`, an array of at least two independent stages with id, objective, scope globs and executable checks. The initial worktree must be clean. Revisions may change only unstarted definitions, keeping stage identity/order.
- `start`: opens one stage only when all preceding stages have successful checkpoint progress. Reopening a completed stage requires a reason; previous attempts remain recorded and later stages must be rechecked (not reimplemented).
- `finish`: closes modification admission, drains in-flight modifying tools and native Jobs, executes checks in foreground process groups, records real output/timing/results, checks unchanged source and creates a local commit when needed. No push occurs here.
- Report the returned `HEPHI_STAGE_CHECKPOINT=<uuid>` on its own line in native progress. Only the frozen successful `reported:true` result records completion. A receipt is saved before completion so recovery can finish the transition.
- All stages completed: restore the original Worker push/PR flow. Before and after the existing cumulative verifier, ready checks clean worktree, HEAD and final source fingerprint. Late changes require reopening and rechecking.

The ledger is `<stateDir>/hephi/<ticket>/execution-plan.json`; actual command logs are adjacent under `stage-evidence/<attempt>/<check>/`. Checks receive the immutable `HEPHI_BASE_COMMIT`. The project command must exit zero only when its acceptance checks succeed. HEPHI does not parse XML or interpret expected failures. Final contract verification remains mandatory.

Implementation shell calls must stay foreground. Native Jobs are drained even if DSH promotes a foreground shell on timeout. New shell/write/edit calls are blocked while checking. In staged mode, implementation delegation tools are denied for the entire cycle, not only while stages remain incomplete. Read tools and job inspection/cancellation remain available. The plugin does not automatically kill unrelated native Jobs or retry forever; a 30-second drain timeout leaves the stage closed and explains the outstanding work. Its own check process groups are killed on timeout/cancellation and must be confirmed stopped before unlocking.

## Recovery and limits

- Retry finish to reconcile a checkpoint; no-change stages have distinct receipt IDs and no empty commits.
- Check failure remains in the ledger; another finish creates a new check attempt.
- A live or unconfirmed check process keeps modification closed. Restart recovery does not kill a potentially reused PID.
- Completed progress receipts can repair an interrupted state transition. On remount, a pending checkpoint also queries its original Session through the public sessionQuery API to reconcile successful owned report call/results; unavailable query service fails explicitly rather than guessing completion.
- Record corruption/contract mismatch fails closed. This is not a malicious-Worker security boundary: the agent still owns its local files. Removing all stage state before remount cannot be distinguished from never opting in without an additional trusted activation source.
- The gate does not identify B's business logic hidden inside A's permitted changes. Arbitrary shell commands can deliberately detach processes outside native Job tracking; the Skill forbids this, but this plugin is not a sandbox.
- Source fingerprint covers HEAD, the Git index tree, and tracked/untracked non-ignored files, including mode and contents. Ignored build outputs are excluded. Stage snapshots reject symlinks. Git submodules and unusual filenames are not supported stage workspaces.
- Stage definitions must not make check commands perform implementation; changed source invalidates evidence. No semantic reviewer verifies this assumption.
- During an actual final ready request, new modifications remain closed until that exact report settles, and accepted writes/native Jobs are drained first. A denied concurrent ready request cannot release another request's closure. After completion, ordinary delivery shell is intentionally available; unverified changes can reach a PR, but cannot pass ready with stale checkpoint evidence.
- No automatic deployment, service restart, new Issue, PR creation or merge is performed by the implementation tests.

## Verification types

`pnpm check`: static checks, unit tests and local integration tests. Stage tests use actual temporary Git repositories and OS processes. Some explicitly inject crash records/identities to exercise recovery; these are fixtures, not real Worker acceptance.

`node scripts/check-stage-host.mjs /path/to/dsh/node_modules`: opt-in actual installed DSH ToolRuntime/Scope/SystemPrompt integration with fixture Agent, Job service, report acknowledgement and final verifier. It checks scoped visibility, real tool dispatch/guards and result-event progression, but does not test model choices, GitHub triggering or actual HEPHI final verification. It starts no host service and does not change the supplied runtime.

**Current-version real Issue end-to-end acceptance remains unverified.** No user-journey or delivery correctness conclusion follows from these tests.

## Recorded checks — 2026-11-03, implementation baseline 93ef338

> The dated checks below are historical records of the earlier single-mode implementation. The current mode contract above and `docs/validation/2026-11-04-optional-execution-modes-verification.md` supersede them.

- `pnpm check`: typecheck passed; 19 test files / 96 tests passed; build passed.
- `git diff --check`: passed.
- `node scripts/check-stage-host.mjs /Users/USER/hephi-isolated-b-20261102/node_modules`: passed against installed rc.5, using only a temporary copy of the plugin build. Scoped stage visibility survived the inherited allow mask; mutation denial, successful progress advancement and ready dispatch worked.
- Earlier native-fixture setup attempts failed because the test harness used obsolete `ctx.start()` and accessed services without an injected context. The fixture was corrected to use Cordis fiber `.await()` and declared dependencies; no running host configuration was changed to obtain success.
- Fixture Agent/Job/report/final-verifier responses are explicitly synthetic. This does not establish a real Worker run, GitHub automatic triggering, final HEPHI verification, PR delivery, user journeys or model compliance with the new Skill.
- Real Git/process tests cover checkpoint progression, missing progress, slow checks/in-flight writes, nonzero failures, timeout termination, spawn failure, source changes, reopening, corruption, interruption receipt reconciliation, repeated finish and final checkpoint freshness. Native job-drain and interruption-state cases include injected fixtures and are not OS-crash or production restart acceptance.

## Self-review — 2026-11-03

Found and corrected, without deploying/restarting a service:

1. **Remount poisoning:** the lazy loader ran permission admission while adopting in-flight call identities. A legitimate denied write in `checking` made the loader permanently rejected. Reproduced with real rc.5 ToolRuntime and fixture Agent, then fixed by separating tracking from admission. The expanded host test now remounts between checkpoint and progress and confirms recovery remains usable.
2. **Index mismatch:** source snapshots did not bind staged content. A check could change only the index, and stale staged content could enter a later commit. Snapshots now include `git write-tree`; checkpoint path collection includes staged paths and uses NUL delimiters. Actual Git/process regression tests verify both cases.
3. **Check launch interruption:** added a persisted launch-pending marker before spawning. Unknown process identity stays closed. PID/log persistence errors no longer reject before the child/group has been stopped and observed. Known non-start and settled-process cases clear the marker; interrupted history remains.
4. **Final ready concurrency:** after ordinary delivery, the real ready request reacquires mutation closure and drains in-flight calls/native Jobs. It retains ownership through the original report result, with token-bound release. Native fixture coverage verifies a second rejected ready cannot unlock the first.
5. **Progress recovery:** pending checkpoint recovery now reads owned Session tool call/result pairs. It accepts only the exact checkpoint marker and an actual successful reported acknowledgement, excluding inherited, failed and unacknowledged records. Stale recovered receipts remain incomplete but can be explicitly reopened. Session event fixtures cover the persistence gap; this is not production crash acceptance.

Final checks: `pnpm check` passed (19 files / 103 tests, typecheck and build); `git diff --check` passed; expanded rc.5 host fixture test passed. The original remount regression failed before the fix with `HEPHI stages unavailable: ... modification is closed`; that failure was not a code-correctness pass.

Known boundaries remain: deleting all local stage state before remount, deliberately detached/untracked processes, and semantic cross-stage modifications are not prevented by this lightweight control. A crash after recording launch intent but before recording PID intentionally requires external termination confirmation. Full real Worker/GitHub/user-journey end-to-end verification remains **not passed / not run for this version**.

### Second self-check (2026-11-03)

Starting revision: `8d8b1a8`. Recovery accepted structurally valid but out-of-order
stage records, and completed check results were matched by count/status without
matching their declared check IDs. Recovery now rejects a completed stage after
an unfinished predecessor, an active stage after a pending predecessor, and
completed evidence whose ordered check IDs differ from the declared checks.
These are record-integrity checks, not a malicious-Worker security boundary.

Validation: `pnpm check` passed (19 test files / 105 tests, typecheck and build).
Two new tests deliberately corrupt persisted records; these are recovery fixtures,
not actual host-crash or Issue E2E tests. The rc.5 host API fixture script passed
at `/var/folders/m_/lzywh6d10vz6xlv3d3x7xqqm0000gq/T/hephi-native-stage-RRSaw4`.
It uses real scoped tool dispatch with fixture Agent, jobs, reports and verifier.
No deployment, service restart or GitHub task was performed.
**真实端到端未验证通过。**

## Repeated self-check loop — 2026-11-03 (starting at efcc3f3)

Only the stage controller/adapter, regression tests and this record changed.
Super Agent, deployment configuration, running services, Skill and delivery flow
were not modified. Each defect below was reproduced before its fix.

| Review pass | Observed failure before fix | Minimal correction / verification |
| --- | --- | --- |
| Persistence/recovery | A recovered `checking` checkpoint with an empty check list accepted successful progress | Validate evidence at checkpoint/commit-intent recovery, not only at `completed`; corrupted-record fixture now rejects |
| Persistence/recovery | Replaced/deleted ledger did not stop an already loaded controller's tool entry | Remember last persisted bytes and check them at entry; replacement/removal fixtures now reject |
| Persistence/recovery | Save-directory failure threw without latching a persistence fault | Enclose directory creation and all save preparation in the failure handler; injected directory failure now stays closed |
| Stage handoff | Actual clean intervening Git commit let B start with stale A evidence | Check the immediate predecessor checkpoint when starting a pending successor; real Git regression passes, explicit reopen/recheck still works |
| Host dispatch | `finish` settled while an admitted mutation was still waiting for dispatch | Track admission through the frozen final tool result; rc.5 scheduler-seam test now waits and rejects late dispatch while checking |
| Host dispatch regression | No new defect found for later guard denial or admitted-call cancellation | Added real rc.5 pipeline cases; admissions are released, subsequent finish does not hang |
| Recovery metadata follow-up | `history: null` was accepted and still allowed tool entry | Reject malformed history on load and include history update in save error handling; corruption fixture now rejects |
| Final recheck | No additional defect found within these reviewed paths | 19 files / 110 tests, typecheck, build and final rc.5 fixture integration passed |

Pre-fix evidence retained in test/run history:
- The initial persistence run had 3 failures / 25 passes. Missing evidence accepted
  progress, changed ledger did not throw, and directory failure did not latch.
- The actual-Git handoff regression resolved to `{stageId: 'B', status: 'in_progress'}`
  when it should reject the changed checkpoint.
- rc.5 admission regression failed with `finish must wait for admitted-but-undispatched
  mutations`; temporary run: `/var/folders/m_/lzywh6d10vz6xlv3d3x7xqqm0000gq/T/hephi-native-stage-i22tSK`.
- Malformed-history regression failed because tool entry did not throw.

The rc.5 test explicitly separates preparation and dispatch using the installed
runtime's scheduler seam for this test only; production code uses public guards,
execute wrappers and result events. Its Agent, jobs, report and final verifier are
fixtures. Persistence corruption and the precise save-failure injection are also
fixtures. They prove the tested control behavior, not real process-crash recovery,
model behavior, GitHub automatic triggering, business journeys or PR delivery.

New operational boundary: while a controller is loaded, external edits (including
reformatting) to its stage record are rejected, rather than silently overwritten.
No signatures, extra registry, scheduler or state machine was introduced. The
previously documented limitations still apply, including total state deletion
before remount and untracked detached processes. **真实端到端未验证通过。**

## Actual host startup regression — 2026-11-03

The first attempted deployment of `72ac261` to the paused B experiment did not
activate HEPHI: Cordis waited for services named `required` and `optional`.
The previous fixture called `mountWorkerGate` directly and missed bundle-entry
activation. No Issue was created under that broken deployment.

Corrected `inject` to the supported service-name array, declaring the five
standard DSH services used by this plugin. This requires those services at plugin
startup; it does not force ordinary tasks to opt into stage control. Extended the
rc.5 fixture to resolve the exported dependencies and run the actual exported
plugin through `ctx.plugin`, observing `apply`'s registry access and disposal.
The new dependency assertion failed before the fix (actual keys required/optional),
then passed with the real Cordis entry and existing adapter checks. Agent registry,
Jobs/report/verifier are still fixtures, not Worker or GitHub E2E acceptance.
`pnpm check`: 19 files / 110 tests, typecheck and build passed.
Real B experiment acceptance is recorded separately under its current-monitor.
