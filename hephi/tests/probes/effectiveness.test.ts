import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { contractHash, prepareActivation, type ActivationContract } from '../../src/control/activation.js'
import { runCheck } from '../../src/control/check-runner.js'
import { checkRunDir, saveRun } from '../../src/control/check-store.js'
import { createEvidenceVerifier, type SessionEvent } from '../../src/control/evidence-verifier.js'
import { gitFingerprint, sha256 } from '../../src/verification/fingerprint.js'

// Delivery-discipline scenarios for Issue #7 "total() must add".
// Real Git worktrees, real shell commands, the real check runner and ready
// verifier. The host bash tool is a thin sh adapter that also records each
// call in a Session event log, as the host does for native executions.
const run = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })

async function git(dir: string, ...args: string[]) { return (await run('git', args, { cwd: dir })).stdout.trim() }
async function commitAll(dir: string, message: string) { await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', message) }

const FROZEN = 'node -e "process.exit(require(\'./src/price.js\').total(2, 3) === 5 ? 0 : 1)"'
const RUN_TESTS = 'for f in tests/*.test.sh tests/hephi/*.test.sh; do [ -e "$f" ] || continue; sh "$f" || exit 1; done'

type CardOverrides = { paths?: string[]; tests?: string[]; budget?: { maxFiles: number; maxChangedLines: number }; frozen?: boolean }
function issueBody(o: CardOverrides = {}): string {
  const card = {
    version: 1, goal: 'total() returns the sum of its two arguments',
    acceptance: [{ id: 'AC1', text: 'total(2, 3) is 5', check: 'tests', paths: o.paths ?? ['src/price.js', 'tests/price*'], tests: o.tests ?? ['tests/price*'] }],
    budget: o.budget ?? { maxFiles: 3, maxChangedLines: 40 },
  }
  return ['```hephi-task', JSON.stringify(card), '```', ...(o.frozen === false ? [] : ['```hephi-test AC1 tests/hephi/AC1.test.sh', FROZEN, '```'])].join('\n')
}

async function project(card: CardOverrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-eff-repo-'))
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-eff-state-'))
  cleanup.push(dir, stateDir)
  await git(dir, 'init', '-q', '-b', 'main')
  await git(dir, 'config', 'user.email', 'probe@example.invalid')
  await git(dir, 'config', 'user.name', 'probe')
  await git(dir, 'remote', 'add', 'origin', 'git@github.com:example/probe.git')
  await mkdir(join(dir, 'src')); await mkdir(join(dir, 'tests')); await mkdir(join(dir, 'deploy'))
  await writeFile(join(dir, 'src/price.js'), 'exports.total = (a, b) => a - b\n')
  for (let i = 0; i < 20; i++) await writeFile(join(dir, `src/m${String(i).padStart(2, '0')}.js`), `exports.value${i} = function () { return ${i} }\n`)
  await writeFile(join(dir, 'tests/smoke.test.sh'), 'node -e "require(\'./src/m00.js\')"\n')
  await writeFile(join(dir, 'tests/legacy.test.sh'), 'node -e "process.exit(require(\'./src/m01.js\').value1() === 1 ? 0 : 1)"\n')
  await writeFile(join(dir, 'deploy/prod.env'), 'REPLICAS=3\n')
  await commitAll(dir, 'base')
  const baseSha = await git(dir, 'rev-parse', 'HEAD')
  const prepared = await prepareActivation({
    HEPHI_ENABLED: '1', HEPHI_STATE_DIR: stateDir, HEPHI_BASE_COMMIT: baseSha, HEPHI_ALLOWED_PATHS: 'src/**,tests/**',
    DSH_SUPERAGENT_TICKET: `t${Math.random().toString(36).slice(2)}`, DSH_SUPERAGENT_DIR: dir,
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'example/probe', DSH_SUPERAGENT_GITHUB_NUMBER: '7', HEPHI_REQUIRE_TASK: '1',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({ version: 1, checks: [{ id: 'tests', kind: 'test', purpose: 'project tests', command: 'sh', args: ['-c', RUN_TESTS], timeoutMs: 20000 }] }),
    HEPHI_ISSUE_BODY: issueBody(card),
  })
  if (!prepared.enabled) throw new Error('not enabled')
  const events: SessionEvent[] = []
  const tools = { execute: async (input: any) => {
    events.push({ type: 'tool/call', data: { name: 'bash', callId: String(input.callId) } })
    let exitCode = 0, stdout = '', stderr = ''
    try {
      const r = await run('sh', ['-c', input.arguments.command], { cwd: input.arguments.workdir, timeout: 20000 })
      stdout = r.stdout; stderr = r.stderr
    } catch (error: any) {
      if (!Number.isInteger(error.code)) throw error
      exitCode = error.code; stdout = error.stdout; stderr = error.stderr
    }
    return { isError: false as const, content: [], value: { kind: 'foreground', exitCode, stdout: { text: stdout }, stderr: { text: stderr } } }
  } }
  return { dir, stateDir, baseSha, contract: prepared.contract, events, tools }
}

type Project = Awaited<ReturnType<typeof project>>
const outer = (id: string): ToolExecution => ({
  callId: `outer-${id}` as never, rootCallId: `outer-${id}` as never, name: 'hephi_check',
  agent: { id: 'worker-session' } as never, arguments: { checkId: id }, signal: new AbortController().signal, token: Symbol(id) as never,
})
const readyCall = (cwd: string): ToolExecution => ({
  callId: 'ready' as never, rootCallId: 'ready' as never, name: 'orchestrator_report', arguments: { state: 'ready' },
  signal: new AbortController().signal, token: Symbol('ready') as never, agent: { session: { header: { cwd, id: 'worker-session' } } } as never,
})
const verifier = (p: Project, events?: SessionEvent[]) => createEvidenceVerifier({ stateDir: p.stateDir, sessionEvents: async () => events ?? p.events, requireSessionBinding: true })

async function deliver(p: Project) {
  const statuses: Record<string, string> = {}
  for (const id of ['tests', 'AC1']) {
    try { statuses[id] = (await runCheck({ stateDir: p.stateDir, contract: p.contract, checkId: id, outer: outer(id), tools: p.tools as never })).status }
    catch (error) { statuses[id] = `refused: ${error instanceof Error ? error.message : String(error)}` }
  }
  const ready = await verifier(p)(p.contract, readyCall(p.dir))
  return { statuses, ready }
}

const fix = (dir: string) => writeFile(join(dir, 'src/price.js'), 'exports.total = (a, b) => a + b\n')

describe('focused delivery', () => {
  it('the focused fix passes: frozen test fails on base, passes on HEAD; evidence is Session-bound', async () => {
    const p = await project()
    await fix(p.dir); await commitAll(p.dir, 'fix total')
    expect(await deliver(p)).toEqual({ statuses: { tests: 'passed', AC1: 'passed' }, ready: { ok: true } })
  })

  it('a Worker-written test also proves the item when the card has no frozen test', async () => {
    const p = await project({ frozen: false })
    await fix(p.dir); await writeFile(join(p.dir, 'tests/price.test.sh'), `${FROZEN}\n`); await commitAll(p.dir, 'fix total with test')
    expect(await deliver(p)).toEqual({ statuses: { tests: 'passed', AC1: 'passed' }, ready: { ok: true } })
  })
})

describe('scope creep and refactoring', () => {
  it('editing a file outside the item scope is refused at check time and at ready', async () => {
    const p = await project()
    await fix(p.dir); await writeFile(join(p.dir, 'src/m05.js'), 'exports.value5 = () => 5\n'); await commitAll(p.dir, 'fix + tidy')
    const result = await deliver(p)
    expect(result.statuses.tests).toContain('changed path outside contract')
    expect(result.ready).toMatchObject({ ok: false, reason: expect.stringContaining('outside the task scope: src/m05.js') })
  })

  it('the earlier 21-file refactor is refused', async () => {
    const p = await project()
    await fix(p.dir)
    for (let i = 0; i < 20; i++) await writeFile(join(p.dir, `src/m${String(i).padStart(2, '0')}.js`), `'use strict'\nmodule.exports = { value${i}: () => ${i} }\n`)
    await commitAll(p.dir, 'fix + refactor')
    expect((await deliver(p)).ready).toMatchObject({ ok: false, reason: expect.stringContaining('outside the task scope') })
  })

  it('with a broad item scope, the budget still refuses a sweeping rewrite', async () => {
    const p = await project({ paths: ['src/**', 'tests/price*'] })
    await fix(p.dir)
    for (let i = 0; i < 20; i++) await writeFile(join(p.dir, `src/m${String(i).padStart(2, '0')}.js`), `'use strict'\nmodule.exports = { value${i}: () => ${i} }\n`)
    await commitAll(p.dir, 'fix + refactor')
    expect((await deliver(p)).ready).toMatchObject({ ok: false, reason: expect.stringContaining('budget is 3') })
  })

  it('with a broad item scope, formatting-only edits and renames are refused', async () => {
    const p = await project({ paths: ['src/**', 'tests/price*'], budget: { maxFiles: 10, maxChangedLines: 100 } })
    await fix(p.dir)
    await writeFile(join(p.dir, 'src/m05.js'), 'exports.value5   =   function () {  return 5 }\n')
    await git(p.dir, 'mv', 'src/m06.js', 'src/six.js')
    await commitAll(p.dir, 'fix + reformat + rename')
    const reason = ((await deliver(p)).ready as { reason: string }).reason
    expect(reason).toContain('formatting-only changes are not allowed by the task: src/m05.js')
    expect(reason).toContain('renames/moves are not allowed by the task: src/m06.js -> src/six.js')
  })
})

describe('goal drift', () => {
  it('not fixing total() is refused even though the project tests pass', async () => {
    const p = await project({ paths: ['src/**', 'tests/price*'] })
    await writeFile(join(p.dir, 'src/m05.js'), 'exports.value5 = () => 50\n'); await commitAll(p.dir, 'unrelated change')
    const result = await deliver(p)
    expect(result.statuses).toEqual({ tests: 'passed', AC1: 'blocked' })
    expect(result.ready).toMatchObject({ ok: false, reason: 'missing, failed or stale evidence: acceptance AC1' })
  })

  it('deleting an existing test is refused', async () => {
    const p = await project({ paths: ['src/price.js', 'tests/**'] })
    await fix(p.dir); await unlink(join(p.dir, 'tests/legacy.test.sh')); await commitAll(p.dir, 'fix + drop test')
    expect((await deliver(p)).ready).toMatchObject({ ok: false, reason: expect.stringContaining('existing tests must not be deleted: tests/legacy.test.sh') })
  })

  it('a Worker test that already passes on base does not prove the item', async () => {
    const p = await project({ frozen: false })
    await fix(p.dir); await writeFile(join(p.dir, 'tests/price.test.sh'), 'node -e "require(\'./src/price.js\')"\n'); await commitAll(p.dir, 'fix with weak test')
    const result = await deliver(p)
    expect(result.statuses.AC1).toBe('blocked')
    expect(result.ready.ok).toBe(false)
  })

  it('residual gap: without a frozen test, a Worker test that only detects "something changed" is accepted', async () => {
    const p = await project({ frozen: false })
    await writeFile(join(p.dir, 'src/price.js'), 'exports.total = (a, b) => a - b // reviewed\n')
    await writeFile(join(p.dir, 'tests/price.test.sh'), 'grep -q reviewed src/price.js\n')
    await commitAll(p.dir, 'cosmetic change with self-serving test')
    expect((await deliver(p)).ready).toEqual({ ok: true })
  })
})

describe('evidence integrity', () => {
  it('a hand-written passing record is refused because the Session has no such native execution', async () => {
    const p = await project()
    await fix(p.dir); await commitAll(p.dir, 'fix total')
    await deliver(p)
    const fp = await gitFingerprint(p.dir, p.baseSha)
    for (const [runId, extra] of [['forged-tests', {}], ['forged-ac1', { acceptanceId: 'AC1', baseInnerCallId: 'fake-base', baseExitCode: 1 }]] as const) {
      await mkdir(checkRunDir(p.stateDir, p.contract.ticketId, runId), { recursive: true })
      await writeFile(join(checkRunDir(p.stateDir, p.contract.ticketId, runId), 'output.log'), 'ok')
      await saveRun(p.stateDir, {
        version: 2, runId, sequence: 100 + runId.length, ticketId: p.contract.ticketId, contractHash: p.contract.contractHash, checkId: 'tests',
        sessionId: 'x', callId: 'x', innerCallId: `fake-${runId}`, argv: [], cwd: p.dir, startedAt: 'x', finishedAt: 'x',
        status: 'passed', exitCode: 0, before: fp, after: fp, outputHash: sha256('ok'), ...extra,
      })
    }
    expect(await verifier(p)(p.contract, readyCall(p.dir))).toMatchObject({ ok: false, reason: expect.stringContaining('not bound to native executions') })
  })

  it('without a Session log, binding fails closed', async () => {
    const p = await project()
    await fix(p.dir); await commitAll(p.dir, 'fix total')
    await deliver(p)
    const verify = createEvidenceVerifier({ stateDir: p.stateDir, requireSessionBinding: true })
    expect(await verify(p.contract, readyCall(p.dir))).toMatchObject({ ok: false, reason: expect.stringContaining('unavailable') })
  })

  it('a frozen test edited after prepare is refused', async () => {
    const p = await project()
    await fix(p.dir); await commitAll(p.dir, 'fix total')
    const { frozenTestDir } = await import('../../src/control/activation.js')
    await writeFile(join(frozenTestDir(p.stateDir, p.contract.ticketId), 'tests/hephi/AC1.test.sh'), 'exit 0\n')
    await expect(runCheck({ stateDir: p.stateDir, contract: p.contract, checkId: 'AC1', outer: outer('AC1'), tools: p.tools as never })).rejects.toThrow('frozen acceptance test changed')
  })

  it('a contract whose task card was edited no longer loads', async () => {
    const p = await project()
    const { activationPath, loadActivation } = await import('../../src/control/activation.js')
    const path = activationPath(p.stateDir, p.contract.ticketId)
    const edited: ActivationContract = { ...p.contract, task: { ...p.contract.task!, budget: { maxFiles: 200, maxChangedLines: 20000 } } }
    await writeFile(path, JSON.stringify(edited))
    await expect(loadActivation(path)).rejects.toThrow('hash mismatch')
    expect(contractHash).toBeTypeOf('function')
  })
})
