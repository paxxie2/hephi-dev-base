/**
 * C4.5 重试上限（本地单测，不连真实宿主）。
 *
 * 计数语义：键 = ticketId + contractHash + checkId；只计**实际运行过**的失败
 * （`blocked` 且原因不是 `check not started:`）；`running`/`unknown` 不计入（保持现有阻塞语义）；
 * 通过后清零；合同 hash 变化后从 0；操作者 `retry-reset`（A3 通道）按单 check 清零。
 *
 * 决策日志 rule `check.retry-limit` 已在 `docs/decisions-format.md` 规则表登记（见该文件规则编号）。
 * 本套件只证明本地机制，不证明真实宿主行为。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck } from '../../src/control/check-runner.js'
import {
  OPERATOR_RESOLUTIONS_ENV, appendResolution, readResolutions, readRuns, resolutionsPath,
  type CheckRunRecord,
} from '../../src/control/check-store.js'
import { createEvidenceVerifier } from '../../src/control/evidence-verifier.js'
import { main as cliMain, type CliIo } from '../../src/cli.js'

const run = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

const checks: VerificationCheck[] = [
  { id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.', required: true, timeoutMs: 5000 },
  { id: 'unit', kind: 'test', purpose: 'unit', command: 'true', args: ['--unit'], cwd: '.', required: true, timeoutMs: 5000 },
  { id: 'never', kind: 'test', purpose: 'not-started fixture', command: 'true', args: [], cwd: 'missing-dir', required: false, timeoutMs: 5000 },
]

async function repo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-retry-repo-'))
  cleanup.push(dir)
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Retry test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/retry-fixture.git'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'a.txt'), 'patched\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  return { dir, baseSha }
}

function contract(dir: string, baseSha: string, contractHash = `sha256:${'a'.repeat(64)}`): ActivationContract {
  return {
    enabled: true, ticketId: 'ticket-1', repository: 'example/retry-fixture', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths: ['**'], requirePullRequest: false,
    verification: { version: 1, checks: checks.map(check => ({ ...check })) }, contractHash,
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

function tools(exitCode = 0) {
  return {
    execute: async () => ({
      isError: false as const, content: [], value: {
        kind: 'foreground', cwd: '/work', exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 5000,
        stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
      },
    }),
  }
}

type X = {
  r: { dir: string; baseSha: string }; stateDir: string; c: ActivationContract
  execute(checkId: string, exitCode?: number, options?: { retryLimit?: number; allowOperatorResolutions?: boolean; contract?: ActivationContract }): Promise<CheckRunRecord>
}

async function fixture(): Promise<X> {
  const r = await repo()
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-retry-state-'))
  cleanup.push(stateDir)
  const c = contract(r.dir, r.baseSha)
  return {
    r, stateDir, c,
    execute: (checkId, exitCode = 0, options = {}) => runCheck({
      stateDir, contract: options.contract ?? c, checkId, outer: outer(checkId), tools: tools(exitCode),
      allowOperatorResolutions: options.allowOperatorResolutions ?? false,
      retryLimit: options.retryLimit,
    }),
  }
}

function io(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = []
  return { io: { out: message => out.push(message), err: message => err.push(message) }, out, err }
}

/** A3 operator config for the CLI: a mode-0600 JSON file (never an environment switch). */
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
  env[OPERATOR_RESOLUTIONS_ENV] = '1' // Worker-inherited switch: must be inert.
  delete env.HEPHI_OPERATOR_CONFIG
  const configPath = await operatorConfigPath(options.enabled !== false)
  if (configPath !== undefined) env.HEPHI_OPERATOR_CONFIG = configPath
  const code = await cliMain(args, env, captured.io)
  return { code, out: captured.out.join('\n'), err: captured.err.join('\n') }
}

function resetArgs(stateDir: string, checkId: string): string[] {
  return [
    'resolve', '--kind', 'retry-reset', '--ticket', 'ticket-1', '--check', checkId,
    '--basis', 'host-terminal', '--status', 'terminated',
    '--host-query', 'reviewed 3 consecutive failures with the operator', '--operator', 'operator-a',
    '--state-dir', stateDir,
  ]
}

async function lastDecisionRule(stateDir: string, ticketId = 'ticket-1'): Promise<string> {
  const text = await readFile(join(stateDir, 'hephi', ticketId, 'decisions.jsonl'), 'utf8')
  return JSON.parse(text.trim().split('\n').at(-1)!).rule
}

describe('C4.5 retry limit: derived counter', () => {
  it('C45-01: the fourth run is refused after three actual-run failures, logged as check.retry-limit', async () => {
    const x = await fixture()
    for (let attempt = 1; attempt <= 3; attempt += 1) expect((await x.execute('build', 1)).status).toBe('blocked')
    const before = await readRuns(x.stateDir, 'ticket-1')
    expect(before).toHaveLength(3)
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
    // 可声称：超限后 hephi_check 不启动，也不写新的执行记录（未启动不计数）。
    expect(await readRuns(x.stateDir, 'ticket-1')).toHaveLength(3)
    expect(await lastDecisionRule(x.stateDir)).toBe('check.retry-limit')
    const decision = JSON.parse((await readFile(join(x.stateDir, 'hephi', 'ticket-1', 'decisions.jsonl'), 'utf8')).trim().split('\n').at(-1)!)
    expect(decision).toMatchObject({ tool: 'hephi_check', effectiveDecision: 'deny', rule: 'check.retry-limit' })
    expect(decision.reason).toContain('state "blocked"')
    expect(decision.reason).not.toContain('operator retry-reset')
  })

  it('C45-02: a passing run clears the counter', async () => {
    const x = await fixture()
    await x.execute('build', 1)
    await x.execute('build', 1)
    expect((await x.execute('build', 0)).status).toBe('passed')
    // 通过后清零：再允许 3 次失败，第 4 次才拒绝。
    for (let attempt = 1; attempt <= 3; attempt += 1) expect((await x.execute('build', 1)).status).toBe('blocked')
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
    // 可声称：最近一次 passed 之后的失败次数从 0 重新累计。
  })

  it('C45-03: a not-started failure is not counted', async () => {
    const x = await fixture()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const record = await x.execute('never', 0)
      expect(record.status).toBe('blocked')
      expect(record.reason).toContain('check not started:')
      // 可声称：`check not started:` 表示检查未实际运行，即使重复 5 次也不触发重试上限。
    }
    // 同一合同内 build 的计数不受影响：仍走正常的 3 次上限。
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('build', 1)
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
  })

  it('C45-04: the operator retry-reset clears exactly one counter and keeps running', async () => {
    const x = await fixture()
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('build', 1)
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
    const reset = await cli(resetArgs(x.stateDir, 'build'))
    expect(reset.code).toBe(0)
    expect(reset.out).toContain('HEPHI retry reset recorded')
    const resolutions = await readResolutions(x.stateDir, 'ticket-1')
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]).toMatchObject({ kind: 'retry-reset', checkId: 'build', contractHash: x.c.contractHash })
    // 重置后可以继续（下一次仍失败也只是重新累计到 1）；runner 需在操作者开关下读取 reset。
    expect((await x.execute('build', 1, { allowOperatorResolutions: true })).status).toBe('blocked')
    // 幂等：重复执行不再写记录。
    const again = await cli(resetArgs(x.stateDir, 'build'))
    expect(again.code).toBe(0)
    expect(again.out).toContain('already recorded')
    expect(await readResolutions(x.stateDir, 'ticket-1')).toHaveLength(1)
  })

  it('C45-05: a Worker cannot reset the counter', async () => {
    const x = await fixture()
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('build', 1)
    // (a) 操作者开关关闭时 CLI 拒绝，且不写记录。
    const blocked = await cli(resetArgs(x.stateDir, 'build'), { enabled: false })
    expect(blocked.code).not.toBe(0)
    // env HEPHI_ALLOW_OPERATOR_RESOLUTIONS=1 is inert; only the operator config enables this.
    expect(blocked.err).toContain('operator resolutions are disabled')
    expect(blocked.err).toContain('--operator-config')
    await expect(readFile(resolutionsPath(x.stateDir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    // (b) 即使存在冒名的 reset 记录，runner 在开关关闭时也不采信（默认 allowOperatorResolutions=false）。
    await appendResolution(x.stateDir, {
      kind: 'retry-reset', ticketId: 'ticket-1', contractHash: x.c.contractHash, checkId: 'build',
      basis: 'host-terminal', hostQuery: 'forged by a worker', operator: 'worker-self',
    })
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
    // 可声称：reset 只能经操作者通道生效；Worker 自己写记录不会解除上限。
  })

  it('C45-06: resetting one check does not reset another check', async () => {
    const x = await fixture()
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('build', 1)
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('unit', 1)
    expect((await cli(resetArgs(x.stateDir, 'build'))).code).toBe(0)
    expect((await x.execute('build', 1, { allowOperatorResolutions: true })).status).toBe('blocked') // build 已重置
    await expect(x.execute('unit', 1, { allowOperatorResolutions: true })).rejects.toThrow(/retry limit/) // unit 未被重置
    // 可声称：reset 的作用域是 ticket+contract+checkId，不跨 check。
  })

  it('C45-07: a contract change starts the counter from zero', async () => {
    const x = await fixture()
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('build', 1)
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
    const changed = { ...x.c, contractHash: `sha256:${'b'.repeat(64)}` }
    expect((await x.execute('build', 1, { contract: changed })).status).toBe('blocked')
    // 可声称：计数按合同 hash 隔离，旧合同的失败不影响新合同。
  })

  it('C45-08: the limit is configurable through runCheck({ retryLimit })', async () => {
    const x = await fixture()
    expect((await x.execute('build', 1, { retryLimit: 1 })).status).toBe('blocked')
    await expect(x.execute('build', 1, { retryLimit: 1 })).rejects.toThrow(/retry limit/)
    const y = await fixture()
    await y.execute('unit', 1, { retryLimit: 2 })
    expect((await y.execute('unit', 1, { retryLimit: 2 })).status).toBe('blocked')
    await expect(y.execute('unit', 1, { retryLimit: 2 })).rejects.toThrow(/retry limit/)
    // 可声称：默认上限 3，可按调用配置为正整数。
  })
})

describe('C4.5 合法对照：重置后修复并通过', () => {
  it('C45-LEGAL-01: after a reset and a real pass, ready succeeds', async () => {
    const x = await fixture()
    for (let attempt = 1; attempt <= 3; attempt += 1) await x.execute('build', 1)
    await expect(x.execute('build', 1)).rejects.toThrow(/retry limit/)
    expect((await cli(resetArgs(x.stateDir, 'build'))).code).toBe(0)
    expect((await x.execute('build', 0, { allowOperatorResolutions: true })).status).toBe('passed')
    expect((await x.execute('unit', 0)).status).toBe('passed')
    const verify = createEvidenceVerifier({ stateDir: x.stateDir })
    expect(await verify(x.c, ready(x.r.dir))).toEqual({ ok: true })
    // 可声称：操作者重置 + 真实通过后，正常交付路径仍然可完成；旧失败记录保留为历史。
  })
})
