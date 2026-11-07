import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main as cliMain, type CliIo } from '../../src/cli.js'
import { contractHash } from '../../src/control/activation.js'

/**
 * C4.9 `hephi summary`（fixture 级，不连真实宿主）：
 * 只读状态目录、合同版本隔离、最新检查证据、验收项分组、plan、coverage 提示、
 * decisions 汇总、--out 安全边界与 exit 语义。
 *
 * 可声称边界：只证明本地状态读取/汇总逻辑与参数/退出码；不证明真实宿主状态、
 * 也不证明 coverage 能判定测试是否有效（它只是风险提示）。
 */

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const TICKET = 'ticket-1'

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

function checks() {
  return [{
    id: 'unit', kind: 'test' as const, purpose: 'fixture check', command: 'true', args: [] as string[],
    cwd: '.', required: true, timeoutMs: 1000,
  }]
}

function taskCard(acceptance?: Array<{ id: string; text: string; check: string; paths: string[] }>) {
  return {
    version: 2 as const,
    goal: 'summary fixture',
    outOfScope: [] as string[],
    acceptance: acceptance ?? [
      { id: 'a', text: 'change a', check: 'unit', paths: ['src/a/**'] },
      { id: 'b', text: 'change b', check: 'unit', paths: ['src/b/**'] },
    ],
  }
}

function contract(acceptance?: Array<{ id: string; text: string; check: string; paths: string[] }>) {
  const base = {
    version: 5,
    enabled: true as const,
    ticketId: TICKET,
    repository: 'example/repo',
    issueNumber: 1,
    workspace: '/tmp/hephi-summary-workspace',
    baseRef: 'main',
    baseSha: 'a'.repeat(40),
    allowedPaths: ['src/**', 'docs/**'],
    requirePullRequest: true,
    executionMode: 'native' as const,
    enforcement: 'enforce' as const,
    verification: { version: 1 as const, checks: checks() },
    plugin: { version: '0.1.0', commit: 'b'.repeat(40) },
    evidence: { requireSessionBinding: false },
    task: taskCard(acceptance),
  }
  return { ...base, contractHash: contractHash(base as never) }
}

type FixtureContract = ReturnType<typeof contract>

async function ticketDir(stateDir: string): Promise<string> {
  const dir = join(stateDir, 'hephi', TICKET)
  await mkdir(dir, { recursive: true })
  return dir
}

async function writeActivation(stateDir: string, value: FixtureContract): Promise<string> {
  const file = join(await ticketDir(stateDir), 'activation.json')
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
  return file
}

function runRecord(over: {
  runId: string
  sequence: number
  startedAt: string
  contractHash: string
  changedFiles: string[]
  head?: string
  status?: 'passed' | 'blocked' | 'running'
}) {
  return {
    version: 3,
    runId: over.runId,
    sequence: over.sequence,
    ticketId: TICKET,
    contractHash: over.contractHash,
    pluginCommit: 'b'.repeat(40),
    checkId: 'unit',
    sessionId: 'worker-session',
    callId: 'call-1',
    innerCallId: 'inner-1',
    argv: ['true'],
    cwd: '.',
    startedAt: over.startedAt,
    status: over.status ?? 'passed',
    exitCode: 0,
    before: { baseCommit: 'a'.repeat(40), patchHash: 'sha256:base', changedFiles: [] as string[] },
    after: {
      baseCommit: 'a'.repeat(40),
      headCommit: over.head ?? 'c'.repeat(40),
      patchHash: 'sha256:after',
      changedFiles: over.changedFiles,
    },
  }
}

async function writeRun(stateDir: string, value: ReturnType<typeof runRecord>): Promise<void> {
  const dir = join(await ticketDir(stateDir), 'checks', value.runId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'run.json'), JSON.stringify(value, null, 2))
}

async function writePlan(stateDir: string, lines: unknown[]): Promise<void> {
  const file = join(await ticketDir(stateDir), 'plan.jsonl')
  await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n')
}

function planEntry(contractHashValue: string, files: string[], at = '2026-11-07T10:00:00.000Z') {
  return { version: 1, at, contractHash: contractHashValue, files }
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, seq: 1, at: '2026-11-07T10:00:00.000Z', ticketId: TICKET, mode: 'enforce',
    effectiveDecision: 'allow', wouldDecision: 'allow', rule: 'check.pass', ...overrides,
  }
}

async function writeDecisions(stateDir: string, lines: unknown[]): Promise<void> {
  const file = join(await ticketDir(stateDir), 'decisions.jsonl')
  await writeFile(file, lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n')
}

/** File path → sha256 of its bytes, for the read-only snapshot (SUM-06). */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) { await walk(child); continue }
      result[child] = createHash('sha256').update(await readFile(child)).digest('hex')
    }
  }
  await walk(dir)
  return result
}

describe('hephi summary — acceptance groups and evidence', () => {
  it('SUM-01: groups changed files into the acceptance items whose paths match', async () => {
    const state = await tempDir('hephi-summary-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x', 'src/b/y'],
    }))
    const result = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--json'])
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.out)
    expect(payload.acceptance.map((item: { id: string; changedFiles: string[] }) => ({ id: item.id, changedFiles: item.changedFiles })))
      .toEqual([{ id: 'a', changedFiles: ['src/a/x'] }, { id: 'b', changedFiles: ['src/b/y'] }])
    expect(payload.unassigned).toEqual([])
    expect(payload.head).toBe('c'.repeat(40))
    expect(payload.contractHash).toBe(value.contractHash)
  })

  it('SUM-02: a changed file outside every acceptance item is listed as unassigned only', async () => {
    const state = await tempDir('hephi-summary-unassigned-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x', 'src/b/y', 'docs/readme.md'],
    }))
    const result = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--json'])
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.out)
    expect(payload.unassigned).toEqual(['docs/readme.md'])
    expect(payload.acceptance.every((item: { changedFiles: string[] }) => !item.changedFiles.includes('docs/readme.md'))).toBe(true)
  })
})

describe('hephi summary — plan, coverage and decisions', () => {
  it('SUM-03: merges only the current-contract plan, sorts/dedupes files and reports match', async () => {
    const state = await tempDir('hephi-summary-plan-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x', 'src/b/y'],
    }))
    await writePlan(state, [
      planEntry(value.contractHash, ['src/b/**']),
      planEntry(value.contractHash, ['src/a/x', 'src/b/**']),
      // Another contract's plan must not leak into this summary.
      planEntry('sha256:other-contract', ['docs/other.md']),
    ])
    const result = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--json'])
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.out)
    expect(payload.plan).toEqual({ files: ['src/a/x', 'src/b/**'], entries: 2, match: true })
  })

  it('SUM-04: attaches a valid coverage hint and only warns on an invalid one (exit 0)', async () => {
    const state = await tempDir('hephi-summary-coverage-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x'],
    }))
    const hintDir = await tempDir('hephi-summary-hint-')
    const hint = join(hintDir, 'coverage-hint.json')
    await writeFile(hint, JSON.stringify({
      schemaVersion: 1,
      kind: 'coverage-hint',
      uncovered: [{ path: 'src/a/x', lines: [4], reason: 'statement not executed by tests' }],
      summary: { changedFiles: 1, uncoveredFiles: 1, uncoveredLines: 1 },
    }))
    const valid = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--coverage-hint', hint, '--json'])
    expect(valid.code).toBe(0)
    const payload = JSON.parse(valid.out)
    expect(payload.coverage).toEqual({
      source: hint,
      uncovered: [{ path: 'src/a/x', lines: [4], reason: 'statement not executed by tests' }],
      summary: { changedFiles: 1, uncoveredFiles: 1, uncoveredLines: 1 },
    })
    expect(valid.out).toContain('coverage')
    // 覆盖提示不是通过/失败判定：它只出现在提示区，不改变 exit 或 ready。
    expect(JSON.stringify(payload)).not.toContain('ready.pass')

    const bad = join(hintDir, 'bad.json')
    await writeFile(bad, '{not json')
    const invalid = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--coverage-hint', bad, '--json'])
    expect(invalid.code).toBe(0)
    expect(invalid.err).toContain('coverage hint ignored')
    expect(JSON.parse(invalid.out).coverage).toEqual({ source: bad, uncovered: [], summary: null })
  })

  it('SUM-04b: the text form states that coverage is only a risk hint and ready is unchanged', async () => {
    const state = await tempDir('hephi-summary-text-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x'],
    }))
    await writeDecisions(state, [
      decision({ seq: 1, rule: 'check.pass', effectiveDecision: 'allow' }),
      decision({ seq: 2, rule: 'ready.awaiting-approval', effectiveDecision: 'deny', at: '2026-11-07T11:00:00.000Z' }),
    ])
    const result = await cli(['summary', '--state-dir', state, '--ticket', TICKET])
    expect(result.code).toBe(0)
    expect(result.out).toContain('acceptance:')
    expect(result.out).toContain('a (unit) paths=src/a/** changed=1')
    expect(result.out).toContain('risk hint only')
    expect(result.out).toContain('NOT a pass/fail decision')
    expect(result.out).toContain('entries=2 allow=1 deny=1')
    expect(result.out).toContain('lastReadyRule=ready.awaiting-approval')
    expect(result.out).toContain('does not change ready')
  })
})

describe('hephi summary — JSON output, read-only state and exit codes', () => {
  it('SUM-05: --json + --out emits the fixed fields and identical JSON bytes', async () => {
    const state = await tempDir('hephi-summary-out-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x'],
    }))
    const outDir = await tempDir('hephi-summary-out-file-')
    const out = join(outDir, 'summary.json')
    const result = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--json', '--out', out])
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.out)
    expect(Object.keys(payload).sort()).toEqual([
      'acceptance', 'contractHash', 'coverage', 'decisions', 'generatedAt', 'head',
      'plan', 'schemaVersion', 'ticketId', 'unassigned',
    ])
    expect(payload.schemaVersion).toBe(1)
    expect(payload.ticketId).toBe(TICKET)
    expect(payload.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The real CLI's stdout is console.log(payload) — one trailing newline; the file has exactly those bytes.
    expect(await readFile(out, 'utf8')).toBe(`${result.out}\n`)
  })

  it('SUM-06: reading a summary never creates or modifies the input state directory', async () => {
    const state = await tempDir('hephi-summary-readonly-')
    const value = contract()
    await writeActivation(state, value)
    await writeRun(state, runRecord({
      runId: 'run-1', sequence: 1, startedAt: '2026-11-07T10:00:00.000Z',
      contractHash: value.contractHash, changedFiles: ['src/a/x'],
    }))
    await writePlan(state, [planEntry(value.contractHash, ['src/**'])])
    await writeDecisions(state, [decision({ seq: 1, rule: 'ready.pass' })])
    const before = await snapshot(state)
    for (const extra of [[], ['--json'], ['--coverage-hint', join(state, 'hephi', TICKET, 'activation.json')]]) {
      const result = await cli(['summary', '--state-dir', state, '--ticket', TICKET, ...extra])
      expect(result.code).toBe(0)
    }
    expect(await snapshot(state)).toEqual(before)
  })

  it('SUM-07: missing checks warn with head=null; a corrupt run.json is exit 1', async () => {
    const state = await tempDir('hephi-summary-checks-')
    const value = contract()
    await writeActivation(state, value)
    const missing = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--json'])
    expect(missing.code).toBe(0)
    expect(missing.err).toContain('no check records for the current contract')
    expect(JSON.parse(missing.out).head).toBeNull()
    expect(JSON.parse(missing.out).unassigned).toEqual([])

    await mkdir(join(await ticketDir(state), 'checks', 'run-1'), { recursive: true })
    await writeFile(join(await ticketDir(state), 'checks', 'run-1', 'run.json'), '{corrupt')
    const corrupt = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--json'])
    expect(corrupt.code).toBe(1)
    expect(corrupt.err).toContain('cannot read the Ticket state')
  })

  it('SUM-08: missing --ticket and unknown arguments are usage errors; --help is exit 0', async () => {
    const missing = await cli(['summary'])
    expect(missing.code).toBe(2)
    expect(missing.err).toContain('--ticket is required')
    const unknown = await cli(['summary', '--ticket', TICKET, '--bogus'])
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('unknown argument: --bogus')
    const help = await cli(['summary', '--help'])
    expect(help.code).toBe(0)
    expect(help.out).toContain('usage: hephi summary --ticket <id>')
  })

  it('SUM-09: --out refuses the input state directory, state inputs and symlink targets', async () => {
    const state = await tempDir('hephi-summary-out-guard-')
    const value = contract()
    const activation = await writeActivation(state, value)
    const inside = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--out', join(state, 'summary.json')])
    expect(inside.code).toBe(2)
    expect(inside.err).toContain('outside the input state directory')
    const overwrite = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--out', activation])
    expect(overwrite.code).toBe(2)
    // An outside symlink whose target is the activation contract is also refused.
    const linkDir = await tempDir('hephi-summary-out-link-')
    const link = join(linkDir, 'summary-link.json')
    await symlink(activation, link)
    const throughLink = await cli(['summary', '--state-dir', state, '--ticket', TICKET, '--out', link])
    expect(throughLink.code).toBe(2)
    expect(throughLink.err).not.toBe('')
    expect(JSON.parse(await readFile(activation, 'utf8')).contractHash).toBe(value.contractHash)
  })
})
