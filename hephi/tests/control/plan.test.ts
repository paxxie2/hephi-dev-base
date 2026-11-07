import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck } from '../../src/control/check-runner.js'
import { readRuns } from '../../src/control/check-store.js'
import { createEvidenceVerifier } from '../../src/control/evidence-verifier.js'
import type { ReadyVerification } from '../../src/control/ready-gate.js'
import { appendPlan, planPath, readPlan, readPlanEntries } from '../../src/control/plan-store.js'

const run = promisify(execFile)

const build: VerificationCheck = {
  id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000,
}
const unit: VerificationCheck = {
  id: 'unit', kind: 'test', purpose: 'test', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000,
}

/** Fixture repository: base commit, then a patch commit touching a.txt (+ extra files). */
async function repo(extraPatched: string[] = []): Promise<{ dir: string; baseSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-plan-repo-'))
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Plan test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/plan-fixture.git'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src', 'keep.ts'), 'base\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'a.txt'), 'patched\n')
  for (const file of extraPatched) {
    await mkdir(dirname(join(dir, file)), { recursive: true })
    await writeFile(join(dir, file), 'patched\n')
  }
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  return { dir, baseSha }
}

function contract(dir: string, baseSha: string): ActivationContract {
  return {
    enabled: true, ticketId: 'ticket-1', repository: 'example/plan-fixture', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths: ['**'], requirePullRequest: false,
    verification: { version: 1, checks: [build, unit] }, contractHash: 'sha256:test',
  }
}

function outer(checkId: string): ToolExecution {
  return {
    callId: `outer-${checkId}` as never, rootCallId: `outer-${checkId}` as never, name: 'hephi_check',
    agent: { id: 'worker-session' } as never, arguments: { checkId }, signal: new AbortController().signal, token: Symbol(checkId) as never,
  }
}

function ready(workspace: string): ToolExecution {
  return {
    callId: 'ready-call' as never, rootCallId: 'ready-call' as never, name: 'orchestrator_report',
    arguments: { state: 'ready' }, signal: new AbortController().signal, token: Symbol('ready') as never,
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

async function setup(extraPatched: string[] = []) {
  const r = await repo(extraPatched)
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-plan-state-'))
  cleanup.push(r.dir, stateDir)
  const c = contract(r.dir, r.baseSha)
  const execute = (checkId: string) => runCheck({ stateDir, contract: c, checkId, outer: outer(checkId), tools: nativeTools() })
  const verify = () => createEvidenceVerifier({ stateDir })(c, ready(r.dir))
  const planFiles = (files: string[], over: { contractHash?: string; note?: string } = {}) =>
    appendPlan(stateDir, c.ticketId, { contractHash: over.contractHash ?? c.contractHash, files, ...(over.note === undefined ? {} : { note: over.note }) })
  return { r, stateDir, c, execute, verify, planFiles }
}

function denialReason(result: ReadyVerification): string {
  if (result.ok) throw new Error('expected the ready check to be denied')
  return result.reason
}

async function lastDecision(stateDir: string): Promise<any> {
  const text = await readFile(join(stateDir, 'hephi', 'ticket-1', 'decisions.jsonl'), 'utf8')
  return JSON.parse(text.trim().split('\n').at(-1)!)
}

describe('plan store (C4.2 append-only)', () => {
  it('rejects unsafe ticket ids and invalid plan files', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-plan-store-'))
    cleanup.push(stateDir)
    await expect(appendPlan(stateDir, '../escape', { contractHash: 'sha256:test', files: ['a.txt'] })).rejects.toThrow('unsafe evidence id')
    await expect(appendPlan(stateDir, 'ticket-1', { contractHash: '', files: ['a.txt'] })).rejects.toThrow('contract hash')
    for (const files of [[], ['/etc/passwd'], ['../escape'], ['src/../evil'], ['src/./a.txt'], ['']]) {
      await expect(appendPlan(stateDir, 'ticket-1', { contractHash: 'sha256:test', files })).rejects.toThrow()
    }
    await expect(readPlan(stateDir, 'ticket-1', 'sha256:test')).resolves.toBeUndefined()
  })

  it('appends versions only and merges files for the current contract', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-plan-store-'))
    cleanup.push(stateDir)
    await appendPlan(stateDir, 'ticket-1', { contractHash: 'sha256:test', files: ['a.txt'], note: 'first version' })
    const afterFirst = await readFile(planPath(stateDir, 'ticket-1'), 'utf8')
    await appendPlan(stateDir, 'ticket-1', { contractHash: 'sha256:test', files: ['src/**'] })
    await appendPlan(stateDir, 'ticket-1', { contractHash: 'sha256:other', files: ['docs/**'] })
    const afterSecond = await readFile(planPath(stateDir, 'ticket-1'), 'utf8')
    expect(afterSecond.startsWith(afterFirst)).toBe(true) // append-only: earlier lines are byte-identical
    expect((await readPlanEntries(stateDir, 'ticket-1')).length).toBe(3)
    expect(await readPlan(stateDir, 'ticket-1', 'sha256:test')).toEqual({ contractHash: 'sha256:test', files: ['a.txt', 'src/**'], entries: 2 })
    expect(await readPlan(stateDir, 'ticket-1', 'sha256:other')).toEqual({ contractHash: 'sha256:other', files: ['docs/**'], entries: 1 })
    expect(await readPlan(stateDir, 'ticket-1', 'sha256:absent')).toBeUndefined()
  })

  it('does not disturb the check evidence scanner', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    const before = await readRuns(x.stateDir, 'ticket-1')
    await x.planFiles(['a.txt'])
    expect(await readRuns(x.stateDir, 'ticket-1')).toEqual(before)
  })
})

describe('ready plan verification (C4.2 degraded: final diff only)', () => {
  it('accepts a diff fully inside an exact-path plan', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    await x.planFiles(['a.txt'])
    expect(await x.verify()).toEqual({ ok: true })
  })

  it('rejects a diff outside the plan, names the files and audits rule plan.outside-plan', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    await x.planFiles(['src/**'])
    const result = await x.verify()
    expect(result.ok).toBe(false)
    const reason = denialReason(result)
    expect(reason).toContain('plan.outside-plan')
    expect(reason).toContain('a.txt')
    expect(await lastDecision(x.stateDir)).toMatchObject({ rule: 'plan.outside-plan', effectiveDecision: 'deny', contractHash: 'sha256:test' })
  })

  it('supports glob plans and unions appended plan versions', async () => {
    const x = await setup(['src/x.ts', 'src/y.ts'])
    await x.execute('build')
    await x.execute('unit')
    await x.planFiles(['src/**'])
    expect((await x.verify()).ok).toBe(false) // a.txt is not covered yet
    await x.planFiles(['a.txt'])
    expect(await x.verify()).toEqual({ ok: true }) // appending a version extends the covered set
  })

  it('keeps the legacy behavior when there is no plan', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    expect(await x.verify()).toEqual({ ok: true })
  })

  it('treats an empty plan log as no plan', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    await writeFile(planPath(x.stateDir, 'ticket-1'), '')
    expect(await x.verify()).toEqual({ ok: true })
  })

  it('ignores a plan bound to a different contract hash', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    await x.planFiles(['src/**'], { contractHash: 'sha256:other-contract' })
    expect(await x.verify()).toEqual({ ok: true }) // another contract's plan neither blocks nor justifies
    await x.planFiles(['src/**'])
    expect((await x.verify()).ok).toBe(false) // the current contract's plan does block
  })

  it('fails closed on a corrupt plan log', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    await writeFile(planPath(x.stateDir, 'ticket-1'), '{not json\n')
    const result = await x.verify()
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('corrupt plan log')
    await expect(readPlan(x.stateDir, 'ticket-1', x.c.contractHash)).rejects.toThrow('corrupt plan log')
  })

  it('fails closed on an invalid plan line (path escape or empty files)', async () => {
    const x = await setup()
    await x.execute('build')
    await x.execute('unit')
    const invalid = { version: 1, at: new Date().toISOString(), contractHash: x.c.contractHash, files: ['../escape'] }
    await writeFile(planPath(x.stateDir, 'ticket-1'), `${JSON.stringify(invalid)}\n`)
    const result = await x.verify()
    expect(result.ok).toBe(false)
    expect(denialReason(result)).toContain('corrupt plan log')
    const empty = { version: 1, at: new Date().toISOString(), contractHash: x.c.contractHash, files: [] }
    await writeFile(planPath(x.stateDir, 'ticket-1'), `${JSON.stringify(empty)}\n`)
    expect((await x.verify()).ok).toBe(false)
  })

  it('lists at most 10 outside files with a remainder count', async () => {
    const extra = Array.from({ length: 12 }, (_value, index) => `src/outside-${String(index).padStart(2, '0')}.ts`)
    const x = await setup(extra)
    await x.execute('build')
    await x.execute('unit')
    await x.planFiles(['a.txt'])
    const result = await x.verify()
    expect(result.ok).toBe(false)
    const reason = denialReason(result)
    expect(reason).toContain('plan.outside-plan')
    expect(reason).toContain('(+2 more)')
    expect(reason).not.toContain('outside-11.ts') // only the first 10 are listed
  })
})
