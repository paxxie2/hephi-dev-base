import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { checkCommand, runCheck } from '../../src/control/check-runner.js'
import { sha256 } from '../../src/verification/fingerprint.js'
import { createEvidenceVerifier, type SessionSnapshot } from '../../src/control/evidence-verifier.js'
import { appendResolution, checkRunDir, readRuns, type CheckRunRecord } from '../../src/control/check-store.js'
import { allowedPath } from '../../src/control/repository.js'
import { pluginCommit } from '../../src/version.js'

const run = promisify(execFile)
const build: VerificationCheck = {
  id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000
}
const test: VerificationCheck = {
  id: 'unit', kind: 'test', purpose: 'test', command: 'pytest', args: [], cwd: '.',
  required: true, timeoutMs: 5000,

}

async function repo(): Promise<{ dir: string; baseSha: string; headSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-ready-repo-'))
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Ready test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/lean-fixture.git'], { cwd: dir })
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

function contract(dir: string, baseSha: string, allowedPaths = ['**'], requirePullRequest = false, checks: VerificationCheck[] = [build, test]): ActivationContract {
  return {
    enabled: true, ticketId: 'ticket-1', repository: 'example/lean-fixture', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths, requirePullRequest,
    verification: { version: 1, checks }, contractHash: 'sha256:test',
  }
}

function outer(checkId: string): ToolExecution {
  return {
    callId: `outer-${checkId}` as never, rootCallId: `outer-${checkId}` as never, name: 'hephi_check',
    agent: { id: 'worker-session' } as never, arguments: { checkId }, signal: new AbortController().signal, token: Symbol(checkId) as never,
  }
}

function ready(workspace: string, prNumber?: number, sessionId: string = 'worker-session'): ToolExecution {
  return {
    callId: 'ready-call' as never, rootCallId: 'ready-call' as never, name: 'orchestrator_report',
    arguments: { state: 'ready', ...(prNumber === undefined ? {} : { pr_number: prNumber }) },
    signal: new AbortController().signal, token: Symbol('ready') as never,
    // A real DSH ready report always carries the Worker Session header; A1-K4 requires it.
    agent: { session: { header: { cwd: workspace, id: sessionId } } } as never,
  }
}

/**
 * A Session snapshot containing exactly the native bash calls/results that the check
 * records claim (the host bash tool is a fixture in this suite). This is the shape
 * sessionBindingProblem looks for; it is not a real DSH Session recording.
 */
function boundSnapshot(sessionId: string, records: CheckRunRecord[], baseSha: string): SessionSnapshot {
  const events: SessionSnapshot['events'] = []
  for (const record of records) {
    const command = checkCommand(baseSha, record.argv[0]!, record.argv.slice(1))
    events.push({ seq: events.length, type: 'tool/call', data: { name: 'bash', callId: record.innerCallId, arguments: JSON.stringify({ command, workdir: record.cwd }) } })
    events.push({ seq: events.length, type: 'tool/result', data: { message: { toolCallId: record.innerCallId, isError: false, content: [] } } })
  }
  return { session: { id: sessionId }, inheritedEventCount: 0, events }
}

/** Contracts are validated by activation.ts, not by the verifier; this sets the fields the verifier reads. */
function bindingContract(contract: ActivationContract, requireSessionBinding: boolean): ActivationContract {
  return { ...contract, version: 3, evidence: { requireSessionBinding } }
}

function nativeTools(exitCode = 0) {
  return {
    execute: async (input: any) => {
      return {
        isError: false as const, content: [],
        value: {
          kind: 'foreground', cwd: '/work', exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
          stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
        },
      }
    },
  }
}

// Focused integration tests: real Git and filesystem; native tool results are fixtures.
// These do not prove a DSH Worker or GitHub end-to-end delivery.
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function setup() {
  const r = await repo(); const stateDir = await mkdtemp(join(tmpdir(), 'hephi-lean-'))
  cleanup.push(r.dir, stateDir)
  const c = contract(r.dir, r.baseSha)
  const execute = (checkId: string, tools = nativeTools()) =>
    runCheck({ stateDir, contract: c, checkId, outer: outer(checkId), tools })
  const verify = () => createEvidenceVerifier({ stateDir })(c, ready(r.dir))
  return { r, stateDir, c, execute, verify }
}
describe('synchronous evidence MVP (fixture integration)', () => {
  it('uses standard recursive globs for root, nested, Chinese and spaced paths', () => {
    for (const file of ['foo.ts', 'src/foo.ts', '目录/有 空格.ts']) expect(allowedPath(file, ['**/*.ts'])).toBe(true)
    expect(allowedPath('src/foo.js', ['**/*.ts'])).toBe(false)
    expect(allowedPath('outside.ts', ['src/**'])).toBe(false)
  })
  it('requires successful exit in recorded evidence', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const record = (await readRuns(x.stateDir, x.c.ticketId)).at(-1)!
    const file = join(checkRunDir(x.stateDir, x.c.ticketId, record.runId), 'run.json')
    await writeFile(file, JSON.stringify({ ...record, exitCode: 1 }))
    expect((await x.verify()).ok).toBe(false)
    await writeFile(file, JSON.stringify(record))
    expect(await x.verify()).toEqual({ ok: true })
  })
  it('requires each frozen check and accepts bound evidence without executing tests at ready', async () => {
    const x = await setup()
    expect((await x.verify()).ok).toBe(false)
    expect((await x.execute('build')).status).toBe('passed')
    expect((await x.verify()).ok).toBe(false)
    expect((await x.execute('unit')).status).toBe('passed')
    expect(await x.verify()).toEqual({ ok: true })
    const records = await readRuns(x.stateDir, x.c.ticketId)
    expect(records.map(r => r.sequence)).toEqual([1, 2])
    await writeFile(join(checkRunDir(x.stateDir, x.c.ticketId, records[1]!.runId), 'output.log'), 'tampered')
    expect((await x.verify()).ok).toBe(false)
  })
  it('rejects changed source, contract and PR head', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    x.c.contractHash = 'changed'; expect((await x.verify()).ok).toBe(false); x.c.contractHash = 'sha256:test'
    x.c.requirePullRequest = true
    const verify = createEvidenceVerifier({ stateDir: x.stateDir, pullRequest: async () => ({ state: 'open', baseRef: 'main', headSha: 'wrong' }) })
    expect((await verify(x.c, ready(x.r.dir, 1))).ok).toBe(false)
    x.c.requirePullRequest = false
    await writeFile(join(x.r.dir, 'a.txt'), 'later change')
    expect((await x.verify()).ok).toBe(false)
  })
  it('blocks nonzero exits and preserves failures across retries', async () => {
    const x = await setup(); await x.execute('build')
    for (const [i, code] of [1, 2, 127].entries()) {
      expect((await x.execute('unit', nativeTools(code))).status).toBe('blocked')
      expect((await x.verify()).ok).toBe(false)
      expect((await x.execute('unit')).status).toBe('passed')
      expect(await x.verify()).toEqual({ ok: true })
      expect(await readRuns(x.stateDir, x.c.ticketId)).toHaveLength(3 + i * 2)
    }
  })
  it('does not use an earlier pass after a later failing check', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    await x.execute('unit', nativeTools(1))
    expect((await x.verify()).ok).toBe(false)
  })
  it('records a real foreground project command failure and retry without XML (local integration)', async () => {
    const x = await setup()
    const check = x.c.verification.checks[1]!
    check.command = process.execPath
    check.args = ['-e', 'require("node:assert/strict").equal(require("node:fs").readFileSync("a.txt", "utf8"), process.env.EXPECTED)']
    const realTools = (expected: string) => ({ execute: async (input: any) => {
      let exitCode = 0, stdout = '', stderr = ''
      try {
        const result = await run('sh', ['-c', input.arguments.command], {
          cwd: input.arguments.workdir, env: { ...process.env, EXPECTED: expected }, timeout: 5000,
        })
        stdout = result.stdout; stderr = result.stderr
      } catch (error: any) {
        if (!Number.isInteger(error.code)) throw error
        exitCode = error.code; stdout = error.stdout; stderr = error.stderr
      }
      return { isError: false as const, content: [], value: { kind: 'foreground', exitCode, stdout: { text: stdout }, stderr: { text: stderr } } }
    } })
    await x.execute('build')
    expect((await x.execute('unit', realTools('wrong') as never)).status).toBe('blocked')
    expect((await x.verify()).ok).toBe(false)
    expect((await x.execute('unit', realTools('patched\n') as never)).status).toBe('passed')
    expect(await x.verify()).toEqual({ ok: true })
    expect((await readRuns(x.stateDir, x.c.ticketId)).map(r => r.status)).toEqual(['passed', 'blocked', 'passed'])
  })
  it('blocks background or uncertain execution without claiming completion', async () => {
    const x = await setup()
    const tools = { execute: async () => ({ isError: false, content: [], value: { kind: 'background', jobId: 'job-1' } }) }
    expect((await x.execute('build', tools as never)).status).toBe('unknown')
    await expect(x.execute('build')).rejects.toThrow('operator resolution')
    expect((await x.verify()).ok).toBe(false)
  })

  it('A3: an enabled operator resolution unblocks re-runs but never turns the old unknown run into passing evidence', async () => {
    const x = await setup()
    const tools = { execute: async () => ({ isError: false, content: [], value: { kind: 'background', jobId: 'job-1' } }) }
    expect((await x.execute('build', tools as never)).status).toBe('unknown')
    const unknown = (await readRuns(x.stateDir, x.c.ticketId)).at(-1)!
    const blocked = await createEvidenceVerifier({ stateDir: x.stateDir })(x.c, ready(x.r.dir))
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toContain('operator resolution')
    const appended = await appendResolution(x.stateDir, {
      ticketId: x.c.ticketId, contractHash: x.c.contractHash, runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'ps: pid gone', operator: 'operator@example.invalid',
    })
    expect(appended.appended).toBe(true)
    // The resolution only restores the right to re-run: the unfinished record is still not evidence.
    const stillNotEvidence = await createEvidenceVerifier({ stateDir: x.stateDir, allowOperatorResolutions: true })(x.c, ready(x.r.dir))
    expect(stillNotEvidence.ok).toBe(false)
    if (!stillNotEvidence.ok) expect(stillNotEvidence.reason).toContain('missing, failed or stale evidence')
    const rerun = (checkId: string) => runCheck({
      stateDir: x.stateDir, contract: x.c, checkId, outer: outer(checkId), tools: nativeTools(), allowOperatorResolutions: true,
    })
    expect((await rerun('build')).status).toBe('passed')
    expect((await rerun('unit')).status).toBe('passed')
    expect(await createEvidenceVerifier({ stateDir: x.stateDir, allowOperatorResolutions: true })(x.c, ready(x.r.dir))).toEqual({ ok: true })
  })

  it('rejects evidence whose recorded argv differs from the frozen check', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const record = (await readRuns(x.stateDir, x.c.ticketId)).at(-1)!
    const file = join(checkRunDir(x.stateDir, x.c.ticketId, record.runId), 'run.json')
    await writeFile(file, JSON.stringify({ ...record, argv: [...record.argv, '--skip-required-assertion'] }))
    expect((await x.verify()).ok).toBe(false)
    await writeFile(file, JSON.stringify(record))
    expect(await x.verify()).toEqual({ ok: true })
  })
  it('rejects evidence whose recorded cwd differs from the frozen check directory', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const record = (await readRuns(x.stateDir, x.c.ticketId)).at(-1)!
    const file = join(checkRunDir(x.stateDir, x.c.ticketId, record.runId), 'run.json')
    await writeFile(file, JSON.stringify({ ...record, cwd: tmpdir() }))
    expect((await x.verify()).ok).toBe(false)
  })


  it('rejects evidence recorded by another plugin build and delivers again after a rerun', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const record = (await readRuns(x.stateDir, x.c.ticketId)).at(-1)!
    const file = join(checkRunDir(x.stateDir, x.c.ticketId, record.runId), 'run.json')
    await writeFile(file, JSON.stringify({ ...record, pluginCommit: 'another-build' }))
    expect((await x.verify()).ok).toBe(false)
    await writeFile(file, JSON.stringify(record))
    expect(await x.verify()).toEqual({ ok: true })
  })
  it('rejects a contract frozen by another plugin build', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const original = x.c.plugin
    x.c.plugin = { version: '0.1.0', commit: 'another-build' }
    expect((await x.verify()).ok).toBe(false)
    x.c.plugin = original
    expect(await x.verify()).toEqual({ ok: true })
  })
  it('refuses check records written before plugin commit tracking', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const record = (await readRuns(x.stateDir, x.c.ticketId)).at(-1)!
    const file = join(checkRunDir(x.stateDir, x.c.ticketId, record.runId), 'run.json')
    await writeFile(file, JSON.stringify({ ...record, version: 2 }))
    await expect(readRuns(x.stateDir, x.c.ticketId)).rejects.toThrow('unsupported or corrupt check evidence')
  })


  it('U-K5-04: a contract requirement is enforced even when the host configuration is off', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const contract = bindingContract(x.c, true)
    // Without a Session reader the frozen requirement cannot be satisfied.
    expect(await createEvidenceVerifier({ stateDir: x.stateDir })(contract, ready(x.r.dir, undefined, 'worker-session')))
      .toMatchObject({ ok: false, reason: expect.stringContaining('requires a Session reader') })
    // With a reader but no native call in the Session it is still refused.
    const records = await readRuns(x.stateDir, contract.ticketId)
    const empty: SessionSnapshot = { session: { id: 'worker-session' }, inheritedEventCount: 0, events: [] }
    expect(await createEvidenceVerifier({ stateDir: x.stateDir, readSession: async () => empty })(contract, ready(x.r.dir, undefined, 'worker-session')))
      .toMatchObject({ ok: false, reason: expect.stringContaining('expected one native call') })
    // Legal: the native calls exist and the Session ids agree.
    const verify = createEvidenceVerifier({ stateDir: x.stateDir, readSession: async () => boundSnapshot('worker-session', records, contract.baseSha) })
    expect(await verify(contract, ready(x.r.dir, undefined, 'worker-session'))).toEqual({ ok: true })
  })

  it('U-K5-05: the host configuration can tighten a contract that leaves binding off, never relax it', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const records = await readRuns(x.stateDir, x.c.ticketId)
    const empty: SessionSnapshot = { session: { id: 'worker-session' }, inheritedEventCount: 0, events: [] }
    const relaxed = bindingContract(x.c, false)
    // host on + no native call -> refused (host tightened the contract)
    expect(await createEvidenceVerifier({ stateDir: x.stateDir, readSession: async () => empty, requireSessionBinding: true })(relaxed, ready(x.r.dir, undefined, 'worker-session')))
      .toMatchObject({ ok: false })
    // host on + native calls -> allowed
    expect(await createEvidenceVerifier({ stateDir: x.stateDir, readSession: async () => boundSnapshot('worker-session', records, relaxed.baseSha), requireSessionBinding: true })(relaxed, ready(x.r.dir, undefined, 'worker-session')))
      .toEqual({ ok: true })
    // contract on + host off is still refused (host cannot relax the contract)
    expect(await createEvidenceVerifier({ stateDir: x.stateDir, readSession: async () => empty })(bindingContract(x.c, true), ready(x.r.dir, undefined, 'worker-session')))
      .toMatchObject({ ok: false })
  })

  it('U-K4-01: a check record written by another Worker Session is rejected with binding on or off', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const records = await readRuns(x.stateDir, x.c.ticketId)
    // Binding off (default): no Session reader is involved, the record's own sessionId is enough.
    expect(await createEvidenceVerifier({ stateDir: x.stateDir })(x.c, ready(x.r.dir, undefined, 'other-session')))
      .toMatchObject({ ok: false, reason: expect.stringContaining('check record belongs to Session') })
    // Binding on: the snapshot claims to be the ready Session, so only the record's
    // sessionId can expose that the evidence came from another Worker Session.
    const verify = createEvidenceVerifier({ stateDir: x.stateDir, readSession: async id => boundSnapshot(id, records, x.c.baseSha), requireSessionBinding: true })
    expect(await verify(x.c, ready(x.r.dir, undefined, 'other-session')))
      .toMatchObject({ ok: false, reason: expect.stringContaining('check record belongs to Session') })
    // A ready report without a Worker Session id cannot prove ownership: fail closed.
    expect(await createEvidenceVerifier({ stateDir: x.stateDir })(x.c, ready(x.r.dir, undefined, '')))
      .toMatchObject({ ok: false, reason: expect.stringContaining('no Worker Session') })
  })

  it('U-K4-02: evidence recorded by the same Worker Session passes with binding on or off', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const records = await readRuns(x.stateDir, x.c.ticketId)
    // Binding off: the matching record sessionId is the only requirement.
    expect(await createEvidenceVerifier({ stateDir: x.stateDir })(x.c, ready(x.r.dir))).toEqual({ ok: true })
    // Binding on: the native call/result must also be present in that Session.
    const verify = createEvidenceVerifier({ stateDir: x.stateDir, readSession: async id => boundSnapshot(id, records, x.c.baseSha), requireSessionBinding: true })
    expect(await verify(x.c, ready(x.r.dir, undefined, 'worker-session'))).toEqual({ ok: true })
  })

  it('U-K5-06: ready decisions record the real binding policy in the decision log', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    const file = join(x.stateDir, 'hephi', x.c.ticketId, 'decisions.jsonl')
    const last = async () => JSON.parse((await readFile(file, 'utf8')).trim().split('\n').at(-1)!)
    // v1/v2 contract (no frozen value) with host off: contract=null, effective=false.
    expect((await x.verify()).ok).toBe(true)
    expect(await last()).toMatchObject({ version: 1, binding: { contract: null, host: false, effective: false } })
    // v3 contract requiring binding while host is off: effective=true, logged as such.
    expect((await createEvidenceVerifier({ stateDir: x.stateDir })(bindingContract(x.c, true), ready(x.r.dir, undefined, 'worker-session'))).ok).toBe(false)
    expect(await last()).toMatchObject({ version: 1, binding: { contract: true, host: false, effective: true }, effectiveDecision: 'deny' })
    // v3 contract leaving binding off while host is on: effective=true.
    expect((await createEvidenceVerifier({ stateDir: x.stateDir, readSession: async () => ({ session: { id: 'worker-session' }, inheritedEventCount: 0, events: [] }), requireSessionBinding: true })(bindingContract(x.c, false), ready(x.r.dir, undefined, 'worker-session'))).ok).toBe(false)
    expect(await last()).toMatchObject({ binding: { contract: false, host: true, effective: true } })
  })

  it('records ready decisions in the per-ticket decision log', async () => {
    const x = await setup(); await x.execute('build'); await x.execute('unit')
    expect((await x.verify()).ok).toBe(true)
    const file = join(x.stateDir, 'hephi', x.c.ticketId, 'decisions.jsonl')
    const read = async () => (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const passed = (await read()).at(-1)
    expect(passed).toMatchObject({ version: 1, tool: 'orchestrator_report', rule: 'ready.pass', effectiveDecision: 'allow', wouldDecision: 'allow', mode: 'enforce' })
    await writeFile(join(x.r.dir, 'a.txt'), 'later change')
    expect((await x.verify()).ok).toBe(false)
    const denied = (await read()).at(-1)
    expect(denied).toMatchObject({ tool: 'orchestrator_report', effectiveDecision: 'deny', wouldDecision: 'deny' })
    expect(denied.rule).toMatch(/^ready\./)
    expect(denied.seq).toBe((await read()).at(-2).seq + 1)
  })

})
