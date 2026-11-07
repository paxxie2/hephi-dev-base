import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck, type CheckTools } from '../../src/control/check-runner.js'
import {
  OPERATOR_RESOLUTIONS_ENV, appendResolution, checkRunDir, operatorResolutionsAllowed, readResolutions, readRuns,
  resolutionFor, resolutionsPath, resolvedRunIds, saveRun, type CheckRunRecord,
} from '../../src/control/check-store.js'
import { pluginCommit } from '../../src/version.js'
import { main as cliMain, type CliIo } from '../../src/cli.js'

const run = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })

const check: VerificationCheck = {
  id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.',
  required: true, timeoutMs: 5000,
}

async function repo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-resolve-repo-'))
  cleanup.push(dir)
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Resolution test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/resolve-check.git'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'a.txt'), 'patched\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  return { dir, baseSha }
}

function context(dir: string, baseSha: string, ticketId = 'ticket-1', contractHash = 'sha256:test'): ActivationContract {
  return {
    enabled: true, ticketId, repository: 'example/resolve-check', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths: ['**'], requirePullRequest: false,
    verification: { version: 1, checks: [{ ...check }] }, contractHash,
  }
}

function outer(checkId = 'build'): ToolExecution {
  return {
    callId: `outer-${checkId}` as never, rootCallId: `outer-${checkId}` as never, name: 'hephi_check',
    agent: { id: 'worker-session' } as never, arguments: { checkId }, signal: new AbortController().signal, token: Symbol(checkId) as never,
  }
}

/** A background check whose Job registry is unavailable leaves an `unknown` record. */
function backgroundTools(): CheckTools {
  return { execute: async () => ({ isError: false, content: [], value: { kind: 'background', jobId: 'job-1' } }) as never }
}

function foregroundTools(cwd: string, exitCode = 0): CheckTools {
  return {
    execute: async () => ({
      isError: false, content: [], value: {
        kind: 'foreground', cwd, exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 5000,
        stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
      },
    }) as never,
  }
}

type X = {
  r: { dir: string; baseSha: string }; stateDir: string; c: ActivationContract
  execute(tools: CheckTools, options?: { allow?: boolean; contract?: ActivationContract }): Promise<CheckRunRecord>
}

async function fixture(ticketId = 'ticket-1', contractHash = 'sha256:test'): Promise<X> {
  const r = await repo()
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-resolve-state-'))
  cleanup.push(stateDir)
  const c = context(r.dir, r.baseSha, ticketId, contractHash)
  return {
    r, stateDir, c,
    execute: (tools, options = {}) => runCheck({
      stateDir, contract: options.contract ?? c, checkId: 'build', outer: outer(), tools,
      allowOperatorResolutions: options.allow ?? true,
    }),
  }
}

async function seedUnknown(x: X, contract?: ActivationContract): Promise<CheckRunRecord> {
  const record = await x.execute(backgroundTools(), { contract })
  expect(record.status).toBe('unknown')
  return record
}

function io(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = []
  return { io: { out: message => out.push(message), err: message => err.push(message) }, out, err }
}

/**
 * A3 operator config for the CLI: a mode-0600 JSON file created per test. The process
 * environment is never an enable channel; tests pass the file path (env path form below).
 */
async function operatorConfigPath(enabled = true): Promise<string | undefined> {
  if (!enabled) return undefined
  const dir = await mkdtemp(join(tmpdir(), 'hephi-operator-config-'))
  cleanup.push(dir)
  const file = join(dir, 'operator.json')
  await writeFile(file, JSON.stringify({ allowOperatorResolutions: true }), { mode: 0o600 })
  return file
}

async function cli(args: string[], options: { enabled?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const captured = io()
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.env ?? {}) }
  // A Worker-inherited switch is always inert; only the operator config path selects the channel.
  env[OPERATOR_RESOLUTIONS_ENV] = '1'
  delete env.HEPHI_OPERATOR_CONFIG
  const configPath = await operatorConfigPath(options.enabled !== false)
  if (configPath !== undefined) env.HEPHI_OPERATOR_CONFIG = configPath
  const code = await cliMain(args, env, captured.io)
  return { code, out: captured.out.join('\n'), err: captured.err.join('\n') }
}

function resolveArgs(stateDir: string, runId: string, overrides: Record<string, string | undefined> = {}, flags: string[] = []): string[] {
  const values: Record<string, string | undefined> = {
    '--ticket': 'ticket-1', '--run': runId, '--basis': 'host-terminal', '--status': 'terminated',
    '--host-query': 'ps -ax: no matching dsh process', '--operator': 'operator-a', '--state-dir': stateDir,
    ...overrides,
  }
  const args: string[] = ['resolve']
  for (const [key, value] of Object.entries(values)) if (value !== undefined) args.push(key, value)
  return [...args, ...flags]
}

async function treeHash(dir: string): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (current: string) => {
    for (const name of (await readdir(current)).sort()) {
      const path = join(current, name)
      if ((await stat(path)).isDirectory()) await walk(path)
      else hash.update(`${path.slice(dir.length)}:${sha256(await readFile(path))}\n`)
    }
  }
  await walk(dir)
  return hash.digest('hex')
}
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

describe('A3 operator resolutions: store', () => {
  it('is disabled unless the host switch is exactly "1"', () => {
    expect(operatorResolutionsAllowed({})).toBe(false)
    expect(operatorResolutionsAllowed({ [OPERATOR_RESOLUTIONS_ENV]: '0' })).toBe(false)
    expect(operatorResolutionsAllowed({ [OPERATOR_RESOLUTIONS_ENV]: 'true' })).toBe(false)
    expect(operatorResolutionsAllowed({ [OPERATOR_RESOLUTIONS_ENV]: '1' })).toBe(true)
  })

  it('rejects invalid resolution records without writing', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const valid = {
      ticketId: 'ticket-1', contractHash: 'sha256:test', runId, basis: 'host-terminal' as const,
      hostQuery: 'no process', operator: 'operator-a',
    }
    await expect(appendResolution(x.stateDir, { ...valid, basis: 'unknown-basis' as never })).rejects.toThrow('basis is invalid')
    await expect(appendResolution(x.stateDir, { ...valid, hostQuery: '   ' })).rejects.toThrow('host query is missing')
    await expect(appendResolution(x.stateDir, { ...valid, operator: 'bad\noperator' })).rejects.toThrow('control characters')
    await expect(appendResolution(x.stateDir, { ...valid, ticketId: '../escape' })).rejects.toThrow('unsafe evidence id')
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves once per run and reports repeats as idempotent', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const input = {
      ticketId: 'ticket-1', contractHash: 'sha256:test', runId, basis: 'host-terminal' as const,
      hostQuery: 'ps -ax: no matching process', operator: 'operator-a',
    }
    const first = await appendResolution(x.stateDir, input)
    expect(first.appended).toBe(true)
    expect(first.resolution.at).toBeTypeOf('string')
    expect(Number.isNaN(Date.parse(first.resolution.at))).toBe(false)
    const bytes = await readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')
    const second = await appendResolution(x.stateDir, { ...input, hostQuery: 'a different query text', operator: 'operator-b' })
    expect(second.appended).toBe(false)
    expect(second.resolution.hostQuery).toBe(input.hostQuery)
    expect(await readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).toBe(bytes)
    expect((await readResolutions(x.stateDir, 'ticket-1')).length).toBe(1)
    const resolutions = await readResolutions(x.stateDir, 'ticket-1')
    expect(resolutions[0]).toMatchObject({
      ticketId: 'ticket-1', contractHash: 'sha256:test', runId, basis: 'host-terminal',
      hostQuery: 'ps -ax: no matching process', operator: 'operator-a',
    })
  })

  it('never rebinds an already resolved run to another contract', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    await appendResolution(x.stateDir, {
      ticketId: 'ticket-1', contractHash: 'sha256:test', runId, basis: 'host-terminal', hostQuery: 'q', operator: 'operator-a',
    })
    await expect(appendResolution(x.stateDir, {
      ticketId: 'ticket-1', contractHash: 'sha256:other', runId, basis: 'host-terminal', hostQuery: 'q', operator: 'operator-a',
    })).rejects.toThrow('already resolved for another contract')
  })
})

describe('A3 operator resolutions: CLI', () => {
  it('rejects every resolve while the host switch is off and writes nothing', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const result = await cli(resolveArgs(x.stateDir, runId), { enabled: false })
    expect(result.code).not.toBe(0)
    // The Worker-inherited HEPHI_ALLOW_OPERATOR_RESOLUTIONS=1 (set by cli()) is inert:
    // without an operator config file the channel stays closed.
    expect(result.err).toContain('operator resolutions are disabled')
    expect(result.err).toContain('--operator-config')
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to resolve an execution the host still reports as running', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const result = await cli(resolveArgs(x.stateDir, runId, { '--status': 'running' }))
    expect(result.code).not.toBe(0)
    expect(result.err).toContain('still reports the check as running')
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves a confirmed terminated execution and keeps the original evidence bytes', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const runDir = checkRunDir(x.stateDir, 'ticket-1', unknown.runId)
    const before = await treeHash(runDir)
    const result = await cli(resolveArgs(x.stateDir, unknown.runId))
    expect(result.code).toBe(0)
    expect(result.out).toContain('HEPHI resolution recorded')
    expect(await treeHash(runDir)).toBe(before)
    const [resolution] = await readResolutions(x.stateDir, 'ticket-1')
    expect(resolution).toMatchObject({
      ticketId: 'ticket-1', contractHash: x.c.contractHash, runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'ps -ax: no matching dsh process', operator: 'operator-a',
    })
    expect((await readRuns(x.stateDir, 'ticket-1'))[0]!.status).toBe('unknown')
  })

  it('reads the host query from --host-query-file', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const file = join(x.r.dir, 'host-query.txt')
    await writeFile(file, 'jobs.get(job-1): not found\nprocess table: absent\n')
    const result = await cli(resolveArgs(x.stateDir, runId, { '--host-query': undefined, '--host-query-file': file }))
    expect(result.code).toBe(0)
    expect((await readResolutions(x.stateDir, 'ticket-1'))[0]!.hostQuery).toContain('process table: absent')
  })

  it('is idempotent through the CLI', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const first = await cli(resolveArgs(x.stateDir, runId))
    const bytes = await readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')
    const second = await cli(resolveArgs(x.stateDir, runId, { '--host-query': 'different text' }))
    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    expect(second.out).toContain('already recorded')
    expect(await readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).toBe(bytes)
    expect((await readResolutions(x.stateDir, 'ticket-1')).length).toBe(1)
  })

  it('requires explicit risk acceptance only when the host query is unavailable', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const noAccept = await cli(resolveArgs(x.stateDir, runId, { '--basis': 'operator-risk-accepted', '--status': 'unavailable' }))
    expect(noAccept.code).toBe(2)
    expect(noAccept.err).toContain('--accept-risk')
    const wrongBasis = await cli(resolveArgs(x.stateDir, runId, { '--status': 'unavailable' }, ['--accept-risk']))
    expect(wrongBasis.code).toBe(2)
    expect(wrongBasis.err).toContain('only accepted with --basis operator-risk-accepted')
    const noRiskBasis = await cli(resolveArgs(x.stateDir, runId, { '--status': 'unavailable' }))
    expect(noRiskBasis.code).toBe(2)
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const accepted = await cli(resolveArgs(x.stateDir, runId, {
      '--basis': 'operator-risk-accepted', '--status': 'unavailable', '--host-query': 'host query unavailable: connection refused',
    }, ['--accept-risk']))
    expect(accepted.code).toBe(0)
    const [resolution] = await readResolutions(x.stateDir, 'ticket-1')
    expect(resolution!.basis).toBe('operator-risk-accepted')
  })

  it('rejects unsafe or incomplete arguments before touching state', async () => {
    const x = await fixture()
    const runId = (await seedUnknown(x)).runId
    const cases: string[][] = [
      resolveArgs(x.stateDir, runId, { '--ticket': '../escape' }),
      resolveArgs(x.stateDir, runId, { '--operator': '   ' }),
      resolveArgs(x.stateDir, runId, { '--basis': 'nope' }),
      resolveArgs(x.stateDir, runId, { '--status': 'nope' }),
      resolveArgs(x.stateDir, runId, { '--run': undefined }),
      resolveArgs(x.stateDir, runId, { '--host-query': undefined }),
      [...resolveArgs(x.stateDir, runId), '--unknown-flag', 'x'],
      resolveArgs(x.stateDir, runId, {}, ['--accept-risk']),
    ]
    for (const args of cases) {
      const result = await cli(args)
      expect(result.code).toBe(2)
    }
    const both = await cli(resolveArgs(x.stateDir, runId, { '--host-query-file': join(x.r.dir, 'missing.txt') }))
    expect(both.code).toBe(2)
    expect(both.err).toContain('only one of --host-query and --host-query-file')
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an unknown run and an already settled run', async () => {
    const x = await fixture()
    const missing = await cli(resolveArgs(x.stateDir, 'does-not-exist'))
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('check run not found')
    const passed = await x.execute(foregroundTools(x.r.dir))
    expect(passed.status).toBe('passed')
    const settled = await cli(resolveArgs(x.stateDir, passed.runId))
    expect(settled.code).not.toBe(0)
    expect(settled.err).toContain('already settled')
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('A3 operator resolutions: runner consumption', () => {
  it('unblocks a rerun after a terminated resolution without touching the old record', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const before = await treeHash(checkRunDir(x.stateDir, 'ticket-1', unknown.runId))
    expect((await cli(resolveArgs(x.stateDir, unknown.runId))).code).toBe(0)
    const rerun = await x.execute(foregroundTools(x.r.dir))
    expect(rerun.status).toBe('passed')
    expect(rerun.sequence).toBe(2)
    expect(rerun.runId).not.toBe(unknown.runId)
    expect((await readRuns(x.stateDir, 'ticket-1')).map(r => r.status)).toEqual(['unknown', 'passed'])
    expect(await treeHash(checkRunDir(x.stateDir, 'ticket-1', unknown.runId))).toBe(before)
    expect((await readResolutions(x.stateDir, 'ticket-1')).length).toBe(1)
  })

  it('resolves a leftover running record left by a host crash', async () => {
    const x = await fixture()
    const runId = '11111111-1111-4111-8111-111111111111'
    await saveRun(x.stateDir, {
      version: 3, runId, sequence: 1, ticketId: 'ticket-1', contractHash: x.c.contractHash, pluginCommit: pluginCommit(),
      checkId: 'build', sessionId: 'worker-session', callId: 'outer-old', innerCallId: 'inner-old',
      argv: ['true'], cwd: x.r.dir, startedAt: '2026-11-07T00:00:00.000Z', status: 'running', exitCode: null,
      before: { baseCommit: x.r.baseSha, patchHash: 'sha256:0000', changedFiles: ['a.txt'] },
    })
    await expect(x.execute(foregroundTools(x.r.dir))).rejects.toThrow('operator resolution')
    expect((await cli(resolveArgs(x.stateDir, runId))).code).toBe(0)
    const rerun = await x.execute(foregroundTools(x.r.dir))
    expect(rerun.status).toBe('passed')
    expect(rerun.sequence).toBe(2)
    expect((await readRuns(x.stateDir, 'ticket-1')).map(r => r.status)).toEqual(['running', 'passed'])
  })

  it('ignores resolutions entirely while the host switch is off', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    await appendResolution(x.stateDir, {
      ticketId: 'ticket-1', contractHash: x.c.contractHash, runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'no process', operator: 'operator-a',
    })
    await expect(x.execute(foregroundTools(x.r.dir), { allow: false })).rejects.toThrow('operator resolution')
    const rerun = await x.execute(foregroundTools(x.r.dir), { allow: true })
    expect(rerun.status).toBe('passed')
  })

  it('does not apply a resolution across tickets', async () => {
    const x = await fixture()
    const ticketA = x.c
    const ticketB = context(x.r.dir, x.r.baseSha, 'ticket-2', 'sha256:test')
    const unknownA = await seedUnknown(x)
    expect((await cli(resolveArgs(x.stateDir, unknownA.runId, { '--ticket': 'ticket-1' }))).code).toBe(0)
    const unknownB = await seedUnknown(x, ticketB)
    await expect(x.execute(foregroundTools(x.r.dir), { contract: ticketB })).rejects.toThrow('operator resolution')
    // A's resolution file is not B's: B still has no resolution record.
    expect((await readResolutions(x.stateDir, 'ticket-1')).length).toBe(1)
    expect((await readResolutions(x.stateDir, 'ticket-2')).length).toBe(0)
    expect((await readRuns(x.stateDir, 'ticket-2')).map(r => r.status)).toEqual(['unknown'])
    expect(unknownB.ticketId).toBe('ticket-2')
    expect(ticketA.ticketId).toBe('ticket-1')
  })

  it('does not apply a resolution recorded for another contract', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const file = resolutionsPath(x.stateDir, 'ticket-1')
    const forged = {
      ticketId: 'ticket-1', contractHash: 'sha256:older-contract', runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'no process', operator: 'operator-a', at: '2026-11-07T00:00:00.000Z',
    }
    await writeFile(file, `${JSON.stringify(forged)}\n`)
    expect(await resolvedRunIds(x.stateDir, 'ticket-1', 'sha256:older-contract')).toEqual(new Set([unknown.runId]))
    await expect(x.execute(foregroundTools(x.r.dir))).rejects.toThrow('operator resolution')
    // Replacing the stale-contract entry with the run's real contract unblocks the rerun.
    await rm(file)
    await appendResolution(x.stateDir, {
      ticketId: 'ticket-1', contractHash: x.c.contractHash, runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'no process', operator: 'operator-a',
    })
    expect((await x.execute(foregroundTools(x.r.dir))).status).toBe('passed')
  })

  it('keeps a resolved execution out of passing evidence', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    expect((await cli(resolveArgs(x.stateDir, unknown.runId))).code).toBe(0)
    const [record] = await readRuns(x.stateDir, 'ticket-1')
    expect(record!.status).toBe('unknown')
    expect(record!.finishedAt).toBeTypeOf('string')
    expect(await resolvedRunIds(x.stateDir, 'ticket-1', x.c.contractHash)).toEqual(new Set([unknown.runId]))
    expect((await resolutionFor(x.stateDir, 'ticket-1', x.c.contractHash, unknown.runId))!.basis).toBe('host-terminal')
    expect(await resolvedRunIds(x.stateDir, 'ticket-1', 'sha256:other')).toEqual(new Set())
    // The store never rewrites the record into passed: evidence still requires a fresh passing run.
    expect((await readRuns(x.stateDir, 'ticket-1')).every(r => r.status !== 'passed')).toBe(true)
  })

  it('leaves the run scanner unaffected by resolutions.jsonl', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    expect((await cli(resolveArgs(x.stateDir, unknown.runId))).code).toBe(0)
    const runs = await readRuns(x.stateDir, 'ticket-1')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.runId).toBe(unknown.runId)
    const checksEntries = await readdir(checkRunDir(x.stateDir, 'ticket-1'))
    expect(checksEntries).toEqual([unknown.runId])
    expect((await readdir(join(x.stateDir, 'hephi', 'ticket-1'))).sort()).toEqual(['checks', 'resolutions.jsonl'])
  })

  it('fails closed when the resolution log is corrupt', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const file = resolutionsPath(x.stateDir, 'ticket-1')
    await writeFile(file, '{"ticketId":"ticket-1", broken json\n')
    await expect(readResolutions(x.stateDir, 'ticket-1')).rejects.toThrow('corrupt resolution log')
    await expect(x.execute(foregroundTools(x.r.dir))).rejects.toThrow('corrupt resolution log')
    const resolved = await cli(resolveArgs(x.stateDir, unknown.runId))
    expect(resolved.code).toBe(1)
    expect(resolved.err).toContain('corrupt resolution log')
  })

  it('fails closed when duplicate resolution lines for one run disagree', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const file = resolutionsPath(x.stateDir, 'ticket-1')
    const base = {
      ticketId: 'ticket-1', contractHash: 'sha256:test', runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'no process', operator: 'operator-a', at: '2026-11-07T00:00:00.000Z',
    }
    await writeFile(file, `${JSON.stringify(base)}\n${JSON.stringify({ ...base, operator: 'operator-b' })}\n`)
    await expect(readResolutions(x.stateDir, 'ticket-1')).rejects.toThrow('conflicting resolution records')
    await expect(x.execute(foregroundTools(x.r.dir))).rejects.toThrow('conflicting resolution records')
  })

  it('deduplicates an identical retried line written with another timestamp', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const file = resolutionsPath(x.stateDir, 'ticket-1')
    const base = {
      ticketId: 'ticket-1', contractHash: 'sha256:test', runId: unknown.runId,
      basis: 'host-terminal', hostQuery: 'no process', operator: 'operator-a', at: '2026-11-07T00:00:00.000Z',
    }
    await writeFile(file, `${JSON.stringify(base)}\n${JSON.stringify({ ...base, at: '2026-11-07T00:00:01.000Z' })}\n`)
    const resolutions = await readResolutions(x.stateDir, 'ticket-1')
    expect(resolutions).toHaveLength(1)
    expect(await resolvedRunIds(x.stateDir, 'ticket-1', 'sha256:test')).toEqual(new Set([unknown.runId]))
  })
})
