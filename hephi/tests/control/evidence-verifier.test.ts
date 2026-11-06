import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck } from '../../src/control/check-runner.js'
import { sha256 } from '../../src/verification/fingerprint.js'
import { createEvidenceVerifier } from '../../src/control/evidence-verifier.js'
import { checkRunDir, readRuns } from '../../src/control/check-store.js'
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

function ready(workspace: string, prNumber?: number): ToolExecution {
  return {
    callId: 'ready-call' as never, rootCallId: 'ready-call' as never, name: 'orchestrator_report',
    arguments: { state: 'ready', ...(prNumber === undefined ? {} : { pr_number: prNumber }) },
    signal: new AbortController().signal, token: Symbol('ready') as never,
    agent: { session: { header: { cwd: workspace } } } as never,
  }
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
