import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main as cliMain, type CliIo } from '../../src/cli.js'

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: message => out.push(message), err: message => err.push(message) }, out, err }
}

async function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const captured = captureIo()
  const code = await cliMain(args, { ...process.env, ...env }, captured.io)
  return { code, out: captured.out.join('\n'), err: captured.err.join('\n') }
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanup.push(dir)
  return dir
}

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    seq: 1,
    at: '2026-11-07T10:00:00.000Z',
    ticketId: 'ticket-1',
    sessionId: 'worker-session',
    callId: 'call-1',
    tool: 'orchestrator_report',
    mode: 'enforce',
    effectiveDecision: 'allow',
    wouldDecision: 'allow',
    rule: 'ready.pass',
    pluginCommit: 'a'.repeat(40),
    ...overrides,
  }
}

async function writeLog(stateDir: string, ticket: string, lines: Array<Record<string, unknown> | string>): Promise<string> {
  const dir = join(stateDir, 'hephi', ticket)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'decisions.jsonl')
  await writeFile(file, `${lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')}\n`)
  return file
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else result.set(child, await readFile(child, 'utf8'))
    }
  }
  await walk(dir)
  return result
}

function lintBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticketId: 'ticket-1',
    allowedPaths: ['src/**', 'docs/**'],
    checks: [{
      id: 'unit', kind: 'test', purpose: 'unit', command: 'node', args: ['scripts/test.js'], cwd: '.',
      required: true, timeoutMs: 60000,
    }],
    task: {
      version: 1,
      goal: 'fix add()',
      outOfScope: ['pricing'],
      acceptance: [{ id: 'a1', text: 'add works', check: 'unit', paths: ['src/**'] }],
    },
    ...overrides,
  }
}

async function writeBundle(bundle: unknown): Promise<string> {
  const dir = await tempDir('hephi-lint-')
  const file = join(dir, 'task.json')
  await writeFile(file, typeof bundle === 'string' ? bundle : JSON.stringify(bundle, null, 2))
  return file
}

describe('hephi stats — decision log summary (read-only)', () => {
  it('summarizes one ticket, counts rules/modes/effective decisions and the time range', async () => {
    const state = await tempDir('hephi-stats-')
    await writeLog(state, 'ticket-1', [
      decision({ seq: 1, rule: 'ready.pass', at: '2026-11-07T09:00:00.000Z' }),
      decision({ seq: 2, rule: 'ready.pass', at: '2026-11-07T11:00:00.000Z', effectiveDecision: 'allow' }),
      decision({ seq: 3, rule: 'check.pass', mode: 'enforce', at: '2026-11-07T10:00:00.000Z' }),
      decision({ seq: 4, rule: 'scope.outside-task', mode: 'shadow', effectiveDecision: 'allow', wouldDecision: 'deny', at: '2026-11-07T12:00:00.000Z' }),
    ])
    const result = await cli(['stats', '--state-dir', state, '--ticket', 'ticket-1'])
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.out).toContain('ticket ticket-1')
    expect(result.out).toContain('entries=4 matched=4 corrupt=0')
    expect(result.out).toContain('mode: enforce=3 shadow=1')
    expect(result.out).toContain('effectiveDecision: allow=4 deny=0')
    expect(result.out).toContain('earliest=2026-11-07T09:00:00.000Z')
    expect(result.out).toContain('latest=2026-11-07T12:00:00.000Z')
    expect(result.out).toMatch(/ready\.pass\s+2/)
    expect(result.out).toMatch(/check\.pass\s+1/)
    expect(result.out).toMatch(/scope\.outside-task\s+1/)
  })

  it('--rule filters by rule prefix and reports raw vs matched entries', async () => {
    const state = await tempDir('hephi-stats-rule-')
    await writeLog(state, 'ticket-1', [
      decision({ seq: 1, rule: 'ready.pass' }),
      decision({ seq: 2, rule: 'ready.evidence-missing' }),
      decision({ seq: 3, rule: 'check.pass' }),
    ])
    const result = await cli(['stats', '--state-dir', state, '--ticket', 'ticket-1', '--rule', 'ready.'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('entries=3 matched=2 corrupt=0')
    expect(result.out).toContain('rulePrefix=ready.')
    expect(result.out).toMatch(/ready\.pass\s+1/)
    expect(result.out).toMatch(/ready\.evidence-missing\s+1/)
    expect(result.out).not.toMatch(/check\.pass\s+1/)
  })

  it('--json emits machine-readable totals without sensitive fields', async () => {
    const state = await tempDir('hephi-stats-json-')
    await writeLog(state, 'ticket-1', [
      decision({ seq: 1, rule: 'ready.pass' }),
      decision({ seq: 2, rule: 'ready.pr-mismatch', effectiveDecision: 'deny', wouldDecision: 'deny' }),
    ])
    const result = await cli(['stats', '--state-dir', state, '--ticket', 'ticket-1', '--json'])
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.out) as {
      schemaVersion: number
      filter: { rulePrefix: string | null }
      tickets: Array<Record<string, unknown>>
      totals: Record<string, unknown>
    }
    expect(payload.schemaVersion).toBe(1)
    expect(payload.filter.rulePrefix).toBeNull()
    expect(payload.tickets).toHaveLength(1)
    expect(payload.tickets[0]).toMatchObject({ ticketId: 'ticket-1', entries: 2, matched: 2, corruptLines: 0 })
    expect(payload.totals).toMatchObject({
      tickets: 1, entries: 2, matched: 2, corruptLines: 0,
      effectiveDecision: { allow: 1, deny: 1 },
      rules: { 'ready.pass': 1, 'ready.pr-mismatch': 1 },
    })
    expect(result.out).not.toContain('worker-session')
    expect(result.out).not.toContain('call-1')
  })

  it('missing log is an empty summary with exit 0', async () => {
    const state = await tempDir('hephi-stats-missing-')
    const result = await cli(['stats', '--state-dir', state, '--ticket', 'ticket-404'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('entries=0 matched=0 corrupt=0')
    expect(result.out).toContain('earliest=none latest=none')
  })

  it('counts corrupt lines, warns on stderr and keeps going', async () => {
    const state = await tempDir('hephi-stats-corrupt-')
    await writeLog(state, 'ticket-1', [
      decision({ seq: 1, rule: 'ready.pass' }),
      '{not json',
      '"just a string"',
      decision({ seq: 1.5 }),
      JSON.stringify({ seq: 2, at: '2026-11-07T10:00:00.000Z', mode: 'enforce', effectiveDecision: 'allow', wouldDecision: 'allow' }),
      decision({ seq: 3, rule: 'check.pass' }),
    ])
    const result = await cli(['stats', '--state-dir', state, '--ticket', 'ticket-1', '--json'])
    expect(result.code).toBe(0)
    expect(result.err).toContain('corrupt decisions.jsonl line 2')
    const payload = JSON.parse(result.out) as { totals: { entries: number; matched: number; corruptLines: number } }
    expect(payload.totals).toEqual(expect.objectContaining({ entries: 6, matched: 2, corruptLines: 4 }))
  })

  it('scans all ticket directories, skips unsafe directory names and leaves files untouched', async () => {
    const state = await tempDir('hephi-stats-all-')
    await writeLog(state, 'ticket-b', [decision({ seq: 1, ticketId: 'ticket-b' })])
    await writeLog(state, 'ticket-a', [
      decision({ seq: 1, ticketId: 'ticket-a', rule: 'check.pass' }),
      decision({ seq: 2, ticketId: 'ticket-a', rule: 'ready.pass' }),
    ])
    await writeLog(state, 'bad name!', [decision({ seq: 1, ticketId: 'bad name!' })])
    await mkdir(join(state, 'hephi', 'empty-ticket'), { recursive: true })
    const before = await snapshot(state)
    const result = await cli(['stats', '--state-dir', state])
    expect(result.code).toBe(0)
    expect(result.out).toContain('tickets=2 entries=3 matched=3 corrupt=0 skipped=1')
    expect(result.out).toContain('ticket-a')
    expect(result.out).toContain('ticket-b')
    expect(result.out).not.toContain('bad name!')
    expect(result.err).toContain('skipped unsafe ticket directory name')
    expect(await snapshot(state)).toEqual(before)
  })

  it('empty log file yields a zero summary', async () => {
    const state = await tempDir('hephi-stats-empty-')
    await writeLog(state, 'ticket-1', [])
    const result = await cli(['stats', '--state-dir', state, '--ticket', 'ticket-1'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('entries=0 matched=0 corrupt=0')
  })

  it('rejects usage errors with exit 2', async () => {
    expect((await cli(['stats', '--bogus'])).code).toBe(2)
    expect((await cli(['stats', '--ticket'])).code).toBe(2)
    expect((await cli(['stats', '--ticket', '../escape'])).code).toBe(2)
    expect((await cli(['stats', '--rule', ''])).code).toBe(2)
  })
})

describe('hephi lint-task — offline task bundle validation', () => {
  it('accepts a valid bundle and prints a summary', async () => {
    const file = await writeBundle(lintBundle())
    const result = await cli(['lint-task', file])
    expect(result.code).toBe(0)
    expect(result.out).toContain('HEPHI task lint: PASS')
    expect(result.out).toContain('acceptance=1 checks=1 allowedPaths=2')
    expect(result.err).toBe('')
  })

  it('accepts flattened task-card fields alongside bundle fields', async () => {
    const file = await writeBundle({
      version: 1,
      goal: 'fix add()',
      outOfScope: [],
      acceptance: [{ id: 'a1', text: 'add works', check: 'unit', paths: ['src/**'] }],
      ticketId: 'ticket-1',
      allowedPaths: ['src/**'],
      checks: [{ id: 'unit', kind: 'test', purpose: 'unit', command: 'node', args: ['test.js'] }],
    })
    const result = await cli(['lint-task', file])
    expect(result.code).toBe(0)
    expect(result.out).toContain('HEPHI task lint: PASS')
  })

  it('fails with readable errors for missing ticketId, unknown or non-test check references', async () => {
    const missingTicket = await writeBundle(lintBundle({ ticketId: undefined }))
    const missing = await cli(['lint-task', missingTicket])
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('ticketId')

    const unknownRef = await writeBundle(lintBundle({
      task: { version: 1, goal: 'g', acceptance: [{ id: 'a1', text: 'x', check: 'missing-check', paths: ['src/**'] }] },
    }))
    const unknown = await cli(['lint-task', unknownRef])
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain('references unknown check')

    const buildRef = await writeBundle(lintBundle({
      checks: [{ id: 'build', kind: 'build', purpose: 'build', command: 'node', args: ['build.js'] }],
      task: { version: 1, goal: 'g', acceptance: [{ id: 'a1', text: 'x', check: 'build', paths: ['src/**'] }] },
    }))
    const build = await cli(['lint-task', buildRef])
    expect(build.code).toBe(1)
    expect(build.err).toContain('must reference a test check')
  })

  it('rejects absolute/escaping allowedPaths and invalid JSON', async () => {
    const absolute = await writeBundle(lintBundle({ allowedPaths: ['/etc/**'] }))
    const absoluteResult = await cli(['lint-task', absolute])
    expect(absoluteResult.code).toBe(1)
    expect(absoluteResult.err).toContain('allowedPaths[0]')

    const escaping = await writeBundle(lintBundle({ allowedPaths: ['../outside/**'] }))
    expect((await cli(['lint-task', escaping])).code).toBe(1)

    const malformed = await writeBundle('{not json')
    const malformedResult = await cli(['lint-task', malformed])
    expect(malformedResult.code).toBe(1)
    expect(malformedResult.err).toContain('not valid JSON')
  })

  it('warns (without failing) for too many acceptance items or too-wide allowedPaths', async () => {
    const acceptance = Array.from({ length: 9 }, (_, index) => ({
      id: `a${index + 1}`, text: `item ${index + 1}`, check: 'unit', paths: ['src/**'],
    }))
    const wide = await writeBundle(lintBundle({
      allowedPaths: Array.from({ length: 51 }, (_, index) => `src/module-${index}/**`),
      task: { version: 1, goal: 'g', acceptance },
    }))
    const result = await cli(['lint-task', wide])
    expect(result.code).toBe(0)
    expect(result.out).toContain('HEPHI task lint: PASS')
    expect(result.err).toContain('>8')
    expect(result.err).toContain('>50')
  })

  it('rejects usage errors with exit 2 and leaves the task file untouched', async () => {
    expect((await cli(['lint-task'])).code).toBe(2)
    const file = await writeBundle(lintBundle())
    const before = await readFile(file, 'utf8')
    expect((await cli(['lint-task', file, '--bogus'])).code).toBe(2)
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})
