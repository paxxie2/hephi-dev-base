# HEPHI Super Agent Plugin Architecture

## Boundary

```text
Super Agent
  Source -> Eval -> Ticket -> Assignment -> Worker Session -> Router

HEPHI plugin
  Contract -> Recipe -> Verification -> Evidence -> Delivery operation
```

The Ticket and Assignment lifecycle has one owner: Super Agent. HEPHI stores domain facts about verification and delivery, but does not implement a task queue, scheduler, worker, session manager, or second retry loop.

## Worker execution

A Ticket gets a persistent Worker Session and workspace. The Worker receives the `hephi-superagent-control` skill and HEPHI tools through the DSH bundle/preset integration. It edits code in that workspace and reports ready through the native Super Agent flow; the HEPHI gate verifies against the immutable base commit supplied by the contract.

HEPHI does not run `dsh --profile headless` for each issue. Long commands use the Worker Session's normal background-job behavior.

## Domain records

The domain identity is:

```text
(ticket_id, assignment_id, attempt_id)
```

A verification run records the base commit, patch hash, individual checks, environment fingerprint, and artifact hashes. A delivery operation records its operation id, request fingerprint, external id, and reconciliation status. These records are evidence and idempotency data, not a second execution state machine.

## Verification gate

```text
base commit check
  -> changed-file and patch capture
  -> recipe checks
  -> forward test
  -> reverse/reproduction test
  -> related regression
  -> report parsing and evidence hashing
```

A process exit code alone cannot make a check pass. Missing reports, failed report parsing, or an un-runnable reverse check produce `failed` or `inconclusive`, never a successful delivery gate.

## Delivery protocol

The first MVP creates a pull request and posts an Issue notification. It does not auto-merge by default. Every mutation has an operation id and a stable request fingerprint. On timeout, the plugin reconciles by operation id, branch, or Issue marker before retrying.

## Integration constraints

- Keep the plugin compatible with the pinned DSH and Super Agent versions.
- Prefer adding tools and skill content to the existing Worker preset over cloning a new Agent runtime.
- Keep the Router responsible for concise human-facing summaries; keep full logs in evidence artifacts.
- Treat Issue text as untrusted input and enforce repository, branch, command, and delivery policy allowlists outside the model.
