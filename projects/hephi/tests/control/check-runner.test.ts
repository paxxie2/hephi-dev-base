import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck, type NativeJobView, type NativeJobs, type CheckTools } from '../../src/control/check-runner.js'
import { checkRunDir, readRuns } from '../../src/control/check-store.js'
import { sha256 } from '../../src/verification/fingerprint.js'

const run = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })

const check: VerificationCheck = {
  id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000,
}

async function repo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-check-job-'))
  cleanup.push(dir)
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Check job test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/check-job.git'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'a.txt'), 'patched\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  return { dir, baseSha }
}

function outer(signal = new AbortController().signal): ToolExecution {
  return {
    callId: 'outer-check' as never, rootCallId: 'outer-check' as never, name: 'hephi_check',
    agent: { id: 'worker-session' } as never, arguments: { checkId: 'build' },
    signal, token: Symbol('check') as never,
  }
}

function context(dir: string, baseSha: string, timeoutMs = check.timeoutMs): ActivationContract {
  return {
    enabled: true, ticketId: 'ticket-1', repository: 'example/check-job', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths: ['**'], requirePullRequest: false,
    verification: { version: 1, checks: [{ ...check, timeoutMs }] }, contractHash: 'sha256:test',
  }
}

async function setup(timeoutMs = check.timeoutMs) {
  const r = await repo()
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-check-state-'))
  cleanup.push(stateDir)
  const c = context(r.dir, r.baseSha, timeoutMs)
  const execute = (tools: CheckTools, jobs?: NativeJobs, signal?: AbortSignal) =>
    runCheck({ stateDir, contract: c, checkId: 'build', outer: outer(signal), tools, jobs })
  return { r, stateDir, c, execute }
}

function bashResult(value: Record<string, unknown>): CheckTools {
  return { execute: async () => ({ isError: false, content: [], value } as never) }
}

function view(status: string, detail?: string): NativeJobView {
  return { status, ...(detail === undefined ? {} : { detail }) }
}

function read(text: string, lossy = false) {
  return { chunks: [{ at: 0, text }], lossy }
}

describe('native background check jobs', () => {
  it('waits on a promoted Job and records its real output and exit code', async () => {
    const x = await setup()
    const calls: Array<Record<string, unknown>> = []
    const jobs: NativeJobs = {
      wait: async (id, timeoutMs, caller, signal) => {
        calls.push({ op: 'wait', id, timeoutMs, caller, hasSignal: signal !== undefined })
        const persisted = (await readRuns(x.stateDir, 'ticket-1')).at(-1)
        expect(persisted?.jobId).toBe('bash-job')
        expect(persisted?.status).toBe('running')
        return view('completed', 'exit code: 0')
      },
      get: () => { throw new Error('unexpected get') },
      readAt: (id, from, caller) => {
        calls.push({ op: 'readAt', id, from, caller })
        return read('real output\n')
      },
      kill: () => { throw new Error('unexpected kill') },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: 'initial\n' }), jobs)
    expect(record.status).toBe('passed')
    expect(record.jobId).toBe('bash-job')
    expect(record.exitCode).toBe(0)
    expect(record.outputHash).toBe(sha256('real output\n'))
    expect(await readFile(join(checkRunDir(x.stateDir, 'ticket-1', record.runId), 'output.log'), 'utf8')).toBe('real output\n')
    expect(calls[0]).toMatchObject({ op: 'wait', id: 'bash-job', caller: 'worker-session', hasSignal: true })
    expect(calls).toContainEqual({ op: 'readAt', id: 'bash-job', from: 0, caller: 'worker-session' })
  })

  it('polls again while the Job is still running instead of treating one wait as completion', async () => {
    const x = await setup()
    let waits = 0
    const jobs: NativeJobs = {
      wait: async () => {
        waits += 1
        return waits === 1 ? view('running') : view('completed', 'exit code: 0')
      },
      get: () => { throw new Error('unexpected get') },
      readAt: () => read('finished\n'),
      kill: () => { throw new Error('unexpected kill') },
    }
    const record = await x.execute(bashResult({ kind: 'background', jobId: 'bash-job' }), jobs)
    expect(record.status).toBe('passed')
    expect(waits).toBe(2)
  })

  it('preserves a failed Job real exit code and blocks it', async () => {
    const x = await setup()
    const jobs: NativeJobs = {
      wait: async () => view('failed', 'exit code: 2'),
      get: () => { throw new Error('unexpected get') },
      readAt: () => read('failure output\n'),
      kill: () => { throw new Error('unexpected kill') },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('blocked')
    expect(record.exitCode).toBe(2)
    expect(record.reason).toContain('native Job failed: exit code: 2')
    expect(await readFile(join(checkRunDir(x.stateDir, 'ticket-1', record.runId), 'output.log'), 'utf8')).toBe('failure output\n')
    expect((await readRuns(x.stateDir, 'ticket-1')).at(-1)?.jobId).toBe('bash-job')
  })

  it('kills and confirms a Job that outlives the contract deadline', async () => {
    const x = await setup(60)
    let killed = false
    const killCalls: Array<Record<string, unknown>> = []
    const jobs: NativeJobs = {
      wait: async (_id, timeoutMs) => {
        await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 20)))
        return view('running')
      },
      get: () => view(killed ? 'killed' : 'running'),
      readAt: () => read('partial\n'),
      kill: (id, caller, reason) => {
        killed = true
        killCalls.push({ id, caller, reason })
        return 'requested'
      },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('blocked')
    expect(record.exitCode).toBeNull()
    expect(record.reason).toContain('contract deadline')
    expect(killed).toBe(true)
    expect(killCalls).toContainEqual({ id: 'bash-job', caller: 'worker-session', reason: 'HEPHI check timeout or cancellation' })
  })

  it('cancels through the caller signal, kills the Job and confirms it stopped', async () => {
    const x = await setup()
    const controller = new AbortController()
    let killed = false
    const jobs: NativeJobs = {
      wait: async () => { controller.abort(); return view('running') },
      get: () => view('killed'),
      readAt: () => read('partial\n'),
      kill: () => { killed = true; return 'requested' },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs, controller.signal)
    expect(record.status).toBe('blocked')
    expect(record.reason).toContain('cancelled')
    expect(killed).toBe(true)
  })

  it('stays unknown when termination cannot be confirmed', async () => {
    const x = await setup(40)
    let killed = false
    const jobs: NativeJobs = {
      wait: async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return view('running')
      },
      get: () => { throw new Error('Job registry access lost') },
      readAt: () => read('partial\n'),
      kill: () => { killed = true; return 'requested' },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('unknown')
    expect(record.reason).toContain('termination is unconfirmed')
    expect(killed).toBe(true)
  })

  it('rejects a source change while the background Job was running', async () => {
    const x = await setup()
    let changed = false
    const jobs: NativeJobs = {
      wait: async () => {
        if (!changed) {
          changed = true
          await writeFile(join(x.r.dir, 'a.txt'), 'changed during check\n')
        }
        return view('completed', 'exit code: 0')
      },
      get: () => { throw new Error('unexpected get') },
      readAt: () => read('ok\n'),
      kill: () => { throw new Error('unexpected kill') },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('blocked')
    expect(record.reason).toBe('source changed during check')
  })

  it('blocks a confirmed terminal Job when its output ring lost bytes', async () => {
    const x = await setup()
    const jobs: NativeJobs = {
      wait: async () => view('completed', 'exit code: 0'),
      get: () => { throw new Error('unexpected get') },
      readAt: () => read('tail only\n', true),
      kill: () => { throw new Error('unexpected kill') },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('blocked')
    expect(record.reason).toContain('output was lost')
  })

  it('blocks a confirmed terminal Job when its result cannot be parsed', async () => {
    const x = await setup()
    const jobs: NativeJobs = {
      wait: async () => view('completed', 'terminated somehow'),
      get: () => { throw new Error('unexpected get') },
      readAt: () => read('done\n'),
      kill: () => { throw new Error('unexpected kill') },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('blocked')
    expect(record.exitCode).toBeNull()
    expect(record.reason).toContain('documented exit-code form')
  })

  it('records a non-cancellation wait failure and still stops and confirms the Job', async () => {
    const x = await setup()
    let killed = false
    const jobs: NativeJobs = {
      wait: async () => { throw new Error('registry transport closed') },
      get: () => view(killed ? 'killed' : 'running'),
      readAt: () => read('partial\n'),
      kill: () => { killed = true; return 'requested' },
    }
    const record = await x.execute(bashResult({ kind: 'promoted', jobId: 'bash-job', timeoutMs: 1000, output: '' }), jobs)
    expect(record.status).toBe('blocked')
    expect(record.reason).toContain('native Job wait failed: registry transport closed')
    expect(record.reason).not.toContain('cancelled')
    expect(killed).toBe(true)
  })

  it('keeps the original foreground pass, non-zero and source-change behavior', async () => {
    const x = await setup()
    const passed = await x.execute(bashResult({
      kind: 'foreground', cwd: x.r.dir, exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 5000,
      stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
    }))
    expect(passed.status).toBe('passed')
    expect(passed.jobId).toBeUndefined()
    const blocked = await x.execute(bashResult({
      kind: 'foreground', cwd: x.r.dir, exitCode: 3, signal: null, timedOut: false, aborted: false, timeoutMs: 5000,
      stdout: { text: '', truncated: false }, stderr: { text: 'bad\n', truncated: false },
    }))
    expect(blocked.status).toBe('blocked')
    expect(blocked.exitCode).toBe(3)
    const changed = await x.execute({
      execute: async () => {
        await writeFile(join(x.r.dir, 'a.txt'), 'changed during check\n')
        return {
          isError: false, content: [], value: {
            kind: 'foreground', cwd: x.r.dir, exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 5000,
            stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
          },
        } as never
      },
    })
    expect(changed.status).toBe('blocked')
    expect(changed.reason).toBe('source changed during check')
  })
})
