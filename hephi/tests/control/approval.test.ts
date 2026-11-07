import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ACTIVATION_VERSION, contractHash, loadActivation, prepareActivation, type ActivationContract,
} from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck } from '../../src/control/check-runner.js'
import { readRuns } from '../../src/control/check-store.js'
import { createEvidenceVerifier } from '../../src/control/evidence-verifier.js'
import type { PullRequestInfo, PullRequestReview } from '../../src/control/repository.js'
import type { ReadyVerification } from '../../src/control/ready-gate.js'

const run = promisify(execFile)

const build: VerificationCheck = {
  id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000,
}
const unit: VerificationCheck = {
  id: 'unit', kind: 'test', purpose: 'test', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000,
}

async function repo(): Promise<{ dir: string; baseSha: string; headSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-approval-repo-'))
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Approval test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/approval-fixture.git'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'a.txt'), 'patched\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  const headSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  return { dir, baseSha, headSha }
}

function contract(
  dir: string, baseSha: string,
  options: { approvers?: string[]; requirePullRequest?: boolean } = {},
): ActivationContract {
  return {
    enabled: true, ticketId: 'ticket-1', repository: 'example/approval-fixture', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths: ['**'], requirePullRequest: options.requirePullRequest ?? false,
    verification: { version: 1, checks: [build, unit], ...(options.approvers === undefined ? {} : { approvers: options.approvers }) },
    contractHash: 'sha256:test',
  }
}

function outer(checkId: string): ToolExecution {
  return {
    callId: `outer-${checkId}` as never, rootCallId: `outer-${checkId}` as never, name: 'hephi_check',
    agent: { id: 'worker-session' } as never, arguments: { checkId }, signal: new AbortController().signal, token: Symbol(checkId) as never,
  }
}

function ready(workspace: string, prNumber?: number): ToolExecution {
  return {
    callId: 'ready-call' as never, rootCallId: 'ready-call' as never, name: 'orchestrator_report',
    arguments: { state: 'ready', ...(prNumber === undefined ? {} : { pr_number: prNumber }) },
    signal: new AbortController().signal, token: Symbol('ready') as never,
    agent: { session: { header: { cwd: workspace, id: 'worker-session' } } } as never,
  }
}

function nativeTools() {
  return {
    execute: async () => ({
      isError: false as const, content: [],
      value: {
        kind: 'foreground', cwd: '/work', exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
        stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
      },
    }),
  }
}

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })

async function setup(options: { approvers?: string[]; requirePullRequest?: boolean } = {}) {
  const r = await repo()
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-approval-state-'))
  cleanup.push(r.dir, stateDir)
  const c = contract(r.dir, r.baseSha, options)
  const execute = (checkId: string) => runCheck({ stateDir, contract: c, checkId, outer: outer(checkId), tools: nativeTools() })
  const verify = (
    fixture: PullRequestInfo | (() => Promise<PullRequestInfo>),
    execution: ToolExecution = ready(r.dir, 7),
  ) => createEvidenceVerifier({ stateDir, pullRequest: typeof fixture === 'function' ? fixture : async () => fixture })(c, execution)
  const pr = (reviews: PullRequestReview[], over: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
    state: 'open', baseRef: 'main', headSha: r.headSha, reviews, ...over,
  })
  return { r, stateDir, c, execute, verify, pr }
}

function denialReason(result: ReadyVerification): string {
  if (result.ok) throw new Error('expected the ready check to be denied')
  return result.reason
}

async function lastDecision(stateDir: string): Promise<any> {
  const text = await readFile(join(stateDir, 'hephi', 'ticket-1', 'decisions.jsonl'), 'utf8')
  return JSON.parse(text.trim().split('\n').at(-1)!)
}

const approved = (commitId: string, author = 'alice'): PullRequestReview => ({ author, state: 'APPROVED', commitId })

describe('C3 human approval (PR reviews at ready time)', () => {
  it('keeps the legacy behavior when approvers are absent', async () => {
    const x = await setup({ requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    expect(await x.verify(x.pr([]))).toEqual({ ok: true })
    expect(await x.verify(x.pr([approved(x.r.headSha)]))).toEqual({ ok: true })
  })

  it('keeps the legacy behavior when approvers is an empty list', async () => {
    const x = await setup({ requirePullRequest: true, approvers: [] })
    await x.execute('build'); await x.execute('unit')
    expect(await x.verify(x.pr([]))).toEqual({ ok: true })
  })

  it('accepts an approval from a listed approver for the current PR HEAD', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    expect(await x.verify(x.pr([approved(x.r.headSha)]))).toEqual({ ok: true })
  })

  it('matches approver logins case-insensitively (GitHub logins are case-insensitive)', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    expect(await x.verify(x.pr([approved(x.r.headSha, 'Alice')]))).toEqual({ ok: true })
  })

  it('does not accept an approval from someone outside the approver list', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const result = await x.verify(x.pr([approved(x.r.headSha, 'bob')]))
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('ready.awaiting-approval')
    expect(denialReason(result)).toContain('no listed approver')
    expect(await lastDecision(x.stateDir)).toMatchObject({ rule: 'ready.awaiting-approval', effectiveDecision: 'deny' })
  })

  it('does not accept an approval that targets an older HEAD', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const result = await x.verify(x.pr([approved('f'.repeat(40))]))
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('ready.awaiting-approval')
  })

  it('rejects after the same approver requests changes (latest review wins)', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const reviews: PullRequestReview[] = [
      approved(x.r.headSha),
      { author: 'alice', state: 'CHANGES_REQUESTED', commitId: x.r.headSha },
    ]
    const result = await x.verify(x.pr(reviews))
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('changes requested by alice')
    expect(denialReason(result)).toContain('not a failed check')
  })

  it('rejects an approval that was later dismissed', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const reviews: PullRequestReview[] = [
      approved(x.r.headSha),
      { author: 'alice', state: 'DISMISSED', commitId: x.r.headSha },
    ]
    expect((await x.verify(x.pr(reviews))).ok).toBe(false)
  })

  it('rejects when a listed approver requests changes even if another approver approves', async () => {
    const x = await setup({ approvers: ['alice', 'bob'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const reviews: PullRequestReview[] = [
      approved(x.r.headSha, 'alice'),
      { author: 'bob', state: 'CHANGES_REQUESTED', commitId: x.r.headSha },
    ]
    const result = await x.verify(x.pr(reviews))
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('changes requested by bob')
  })

  it('uses only the latest review per approver (a later comment invalidates approval)', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const reviews: PullRequestReview[] = [
      { author: 'alice', state: 'APPROVED', commitId: x.r.headSha },
      { author: 'alice', state: 'COMMENTED', commitId: x.r.headSha },
    ]
    expect((await x.verify(x.pr(reviews))).ok).toBe(false)
  })

  it('is a wait state, not a failed check: no check records or retry counters change', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const recordsBefore = await readRuns(x.stateDir, 'ticket-1')
    const result = await x.verify(x.pr([]))
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('waiting for approval')
    expect(denialReason(result)).toContain('not a failed check')
    expect(await readRuns(x.stateDir, 'ticket-1')).toEqual(recordsBefore)
    expect(await lastDecision(x.stateDir)).toMatchObject({ rule: 'ready.awaiting-approval' })
  })

  it('keeps the existing PR/base/HEAD denial semantics, including with approvers', async () => {
    const plain = await setup({ requirePullRequest: true })
    await plain.execute('build'); await plain.execute('unit')
    const mismatch = await plain.verify(plain.pr([], { headSha: 'f'.repeat(40) }))
    expect(denialReason(mismatch)).toBe('PR/base/HEAD mismatch')
    const withApprovers = await setup({ approvers: ['alice'], requirePullRequest: true })
    await withApprovers.execute('build'); await withApprovers.execute('unit')
    const result = await withApprovers.verify(withApprovers.pr([approved(withApprovers.r.headSha)], { headSha: 'f'.repeat(40) }))
    expect(denialReason(result)).toBe('PR/base/HEAD mismatch')
  })

  it('keeps the existing missing-PR failure (gh not found) instead of waiting', async () => {
    const x = await setup({ requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const result = await x.verify(async () => { throw new Error('gh: Not Found') })
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('gh: Not Found')
  })

  it('waits for a pr_number when approvers are configured but requirePullRequest is false', async () => {
    const x = await setup({ approvers: ['alice'] })
    await x.execute('build'); await x.execute('unit')
    const result = await x.verify(x.pr([approved(x.r.headSha)]), ready(x.r.dir))
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('ready.awaiting-approval')
    expect(denialReason(result)).toContain('pr_number is required')
    expect((await x.verify(x.pr([approved(x.r.headSha)]), ready(x.r.dir, 7))).ok).toBe(true)
  })

  it('fails closed when the host returns no reviews for a configured approver list', async () => {
    const x = await setup({ approvers: ['alice'], requirePullRequest: true })
    await x.execute('build'); await x.execute('unit')
    const result = await x.verify({ state: 'open', baseRef: 'main', headSha: x.r.headSha })
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('ready.awaiting-approval')
    expect(denialReason(result)).toContain('PR reviews are unavailable')
  })
})

// ---------------------------------------------------------------------------
// Contract format v5: approvers are frozen at prepare and old formats stay read-only.
// ---------------------------------------------------------------------------
async function activationStateDir(): Promise<string> { return mkdtemp(join(tmpdir(), 'hephi-approval-activation-')) }

function enabledEnv(dir: string, verifications: unknown): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1',
    HEPHI_STATE_DIR: dir,
    HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["dubbo-common/**"]',
    DSH_SUPERAGENT_TICKET: 'ticket-1',
    DSH_SUPERAGENT_DIR: '/tmp/ticket-1',
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo',
    DSH_SUPERAGENT_GITHUB_NUMBER: '42',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify(verifications),
  }
}

const verificationConfig = (approvers?: string[]) => ({
  version: 1,
  checks: [{ id: 'fixture-build', kind: 'build', purpose: 'fixture command', command: 'true', args: [], cwd: '.', required: true, timeoutMs: 5000 }],
  ...(approvers === undefined ? {} : { approvers }),
})

async function prepared() {
  const result = await prepareActivation(enabledEnv(await activationStateDir(), verificationConfig(['alice', 'bob'])))
  if (!result.enabled) throw new Error('activation was not enabled')
  return { result, raw: JSON.parse(await readFile(result.filePath, 'utf8')) as Record<string, unknown> }
}

function withoutHash(raw: Record<string, unknown>): Record<string, unknown> {
  const { contractHash: _hash, ...base } = raw
  return base
}

describe('C3 contract version 5 (approvers frozen, v1–v4 read-only)', () => {
  it('prepare writes version 5 with frozen approvers inside the contract hash', async () => {
    const { result, raw } = await prepared()
    expect(ACTIVATION_VERSION).toBe(5)
    expect(result.contract.version).toBe(5)
    expect(raw.version).toBe(5)
    expect((raw.verification as { approvers?: string[] }).approvers).toEqual(['alice', 'bob'])
    expect(raw.contractHash).toBe(contractHash(withoutHash(raw) as never))
    await expect(loadActivation(result.filePath)).resolves.toEqual(result.contract)
  })

  it('rejects a v4 contract that smuggles approvers (older writers could not freeze them)', async () => {
    const { result, raw } = await prepared()
    const downgraded: Record<string, unknown> = { ...raw, version: 4 }
    delete downgraded.contractHash
    downgraded.contractHash = contractHash(withoutHash(downgraded) as never)
    await writeFile(result.filePath, `${JSON.stringify(downgraded, null, 2)}\n`)
    await expect(loadActivation(result.filePath)).rejects.toThrow('unsupported HEPHI activation field for this version: verification.approvers')
  })

  it('still reads a v4 contract without approvers (C1 protectedAssets semantics unaffected)', async () => {
    const { result, raw } = await prepared()
    const v4: Record<string, unknown> = { ...raw, version: 4 }
    const verification = { ...(v4.verification as Record<string, unknown>) }
    delete verification.approvers
    v4.verification = verification
    delete v4.contractHash
    v4.contractHash = contractHash(withoutHash(v4) as never)
    await writeFile(result.filePath, `${JSON.stringify(v4, null, 2)}\n`)
    const loaded = await loadActivation(result.filePath)
    expect(loaded.version).toBe(4)
    expect(loaded.verification.approvers).toBeUndefined()
  })

  it('validates approver usernames at prepare (invalid or duplicate list rejected)', async () => {
    await expect(prepareActivation(enabledEnv(await activationStateDir(), verificationConfig(['not a login'])))).rejects.toThrow()
    await expect(prepareActivation(enabledEnv(await activationStateDir(), verificationConfig(['Alice', 'alice'])))).rejects.toThrow('duplicate approver')
  })
})
