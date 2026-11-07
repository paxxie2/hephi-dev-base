/**
 * A3 可信边界（本地单测，不连真实宿主）。
 *
 * 目标：进程环境变量**不再是**操作者通道的启用开关。
 *   - 插件侧：只有宿主配置 `apply(ctx, { allowOperatorResolutions, retryLimit })` 能开启；
 *   - CLI 侧：只有操作者提供的 mode-0600 JSON 配置文件（--operator-config 或
 *     HEPHI_OPERATOR_CONFIG 路径）能开启；group/other 可访问、内容不为 true、缺失都拒绝；
 *   - Worker 继承的 HEPHI_ALLOW_OPERATOR_RESOLUTIONS=1 对 runner/verifier/CLI 全部无效。
 *
 * 可声称边界：只证明本地机制的切换与拒绝路径；真实宿主 cordis 配置接线/G1 第 9 项未验证。
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { VerificationCheck } from '../../src/contracts/checks.js'
import { runCheck } from '../../src/control/check-runner.js'
import { activationPath, loadActivation, prepareActivation } from '../../src/control/activation.js'
import {
  appendResolution, readResolutions, readRuns, resolutionsPath, type CheckRunRecord,
} from '../../src/control/check-store.js'
import { createEvidenceVerifier } from '../../src/control/evidence-verifier.js'
import { apply } from '../../src/index.js'
import { main as cliMain, type CliIo } from '../../src/cli.js'

const run = promisify(execFile)
const cleanup: string[] = []
const ENV_SWITCH = 'HEPHI_ALLOW_OPERATOR_RESOLUTIONS'
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const TICKET = 'ticket-1'
const checks: VerificationCheck[] = [
  { id: 'build', kind: 'build', purpose: 'build', command: 'true', args: [], cwd: '.', required: true, timeoutMs: 5000 },
  { id: 'unit', kind: 'test', purpose: 'unit', command: 'true', args: ['--unit'], cwd: '.', required: true, timeoutMs: 5000 },
]

async function repo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-tb-repo-'))
  cleanup.push(dir)
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Trust test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/trust-fixture.git'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'a.txt'), 'patched\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  return { dir, baseSha }
}

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-tb-state-'))
  cleanup.push(dir)
  return dir
}

function contract(dir: string, baseSha: string): ActivationContract {
  return {
    enabled: true, ticketId: TICKET, repository: 'example/trust-fixture', issueNumber: 42,
    workspace: dir, baseRef: 'main', baseSha, allowedPaths: ['**'], requirePullRequest: false,
    verification: { version: 1, checks: checks.map(check => ({ ...check })) }, contractHash: 'sha256:test',
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
    callId: 'ready-call' as never, rootCallId: 'ready-call' as never, name: 'orchestrator_report', arguments: { state: 'ready' },
    signal: new AbortController().signal, token: Symbol('ready') as never,
    agent: { session: { header: { cwd: workspace, id: 'worker-session' } } } as never,
  }
}
function tools(exitCode = 0) {
  return {
    execute: async () => ({
      isError: false as const, content: [], value: {
        kind: 'foreground', cwd: '/work', exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
        stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
      },
    }),
  }
}
function backgroundTools() {
  return { execute: async () => ({ isError: false, content: [], value: { kind: 'background', jobId: 'job-1' } }) }
}

type X = { r: { dir: string; baseSha: string }; stateDir: string; c: ActivationContract }
/** A prepared world: the activation contract exists on disk so mounts can bind to it. */
async function fixture(): Promise<X> {
  const r = await repo(); const sd = await stateDir()
  await prepareActivation({
    HEPHI_ENABLED: '1', HEPHI_STATE_DIR: sd, HEPHI_BASE_COMMIT: r.baseSha, HEPHI_ALLOWED_PATHS: '**',
    DSH_SUPERAGENT_TICKET: TICKET, DSH_SUPERAGENT_DIR: r.dir,
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'example/trust-fixture', DSH_SUPERAGENT_GITHUB_NUMBER: '42',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({ version: 1, checks: checks.map(check => ({ ...check })) }),
  })
  const c = await loadActivation(activationPath(sd, TICKET))
  return { r, stateDir: sd, c }
}
async function execute(x: X, exitCodeOrTools: number | { execute: any } = 0, options: { allowOperatorResolutions?: boolean; retryLimit?: number; contract?: ActivationContract } = {}): Promise<CheckRunRecord> {
  const t = typeof exitCodeOrTools === 'number' ? tools(exitCodeOrTools) : exitCodeOrTools
  return runCheck({
    stateDir: x.stateDir, contract: options.contract ?? x.c, checkId: 'build', outer: outer('build'), tools: t as never,
    allowOperatorResolutions: options.allowOperatorResolutions, retryLimit: options.retryLimit,
  })
}
async function seedUnknown(x: X): Promise<CheckRunRecord> {
  const record = await execute(x, backgroundTools())
  expect(record.status).toBe('unknown')
  return record
}
async function resolveRun(x: X, record: CheckRunRecord): Promise<void> {
  await appendResolution(x.stateDir, {
    ticketId: TICKET, contractHash: x.c.contractHash, runId: record.runId,
    basis: 'host-terminal', hostQuery: 'ps -ax: no matching process', operator: 'operator-a',
  })
}

function io(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = []
  return { io: { out: message => out.push(message), err: message => err.push(message) }, out, err }
}
async function cli(args: string[], env: NodeJS.ProcessEnv) {
  const captured = io()
  const code = await cliMain(args, env, captured.io)
  return { code, out: captured.out.join('\n'), err: captured.err.join('\n') }
}
function resolveArgs(stateDir: string, runId: string): string[] {
  return [
    'resolve', '--ticket', TICKET, '--run', runId, '--basis', 'host-terminal', '--status', 'terminated',
    '--host-query', 'ps -ax: no matching process', '--operator', 'operator-a', '--state-dir', stateDir,
  ]
}
function operatorEnv(over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.HEPHI_OPERATOR_CONFIG
  delete env[ENV_SWITCH]
  return { ...env, ...over }
}
async function operatorConfig(content: unknown = { allowOperatorResolutions: true }, mode = 0o600): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-operator-config-'))
  cleanup.push(dir)
  const file = join(dir, 'operator.json')
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content), { mode })
  await chmod(file, mode)
  return file
}
async function noResolutions(x: X): Promise<void> {
  await expect(readFile(resolutionsPath(x.stateDir, TICKET), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
}

// ---- minimal mount fixture (for plugin-config passthrough) ----
type PreExecute = (execution: ToolExecution, next: () => Promise<any>) => Promise<any>
type RegisteredTool = { name: string; execute: (args: any, execution: ToolExecution) => Promise<any> }
function fakeAgent(cwd: string, exitCode = 0) {
  const listeners = new Map<string, Function>()
  const registered: RegisteredTool[] = []
  const agent = {
    session: { header: { id: 'worker-ticket-1', agentPreset: 'dsh-superagent-worker', cwd } },
    ctx: {
      on: (name: string, listener: Function) => { listeners.set(name, listener); return () => listeners.delete(name) },
      tools: {
        register: (definition: RegisteredTool) => { registered.push(definition); return () => true },
        guard: () => () => true,
        execute: async () => ({
          isError: false as const, content: [], value: {
            kind: 'foreground', cwd: '/work', exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
            stdout: { text: 'ok\n', truncated: false }, stderr: { text: '', truncated: false },
          },
        }),
      },
      systemPrompt: { section: () => () => true },
      get: () => undefined,
    },
  } as unknown as Agent
  return { agent, registered, callbacks: () => ({ preExecute: listeners.get('tools/pre-execute') as PreExecute | undefined }) }
}
function checkTool(registered: RegisteredTool[]): RegisteredTool {
  return registered.find(tool => tool.name === 'hephi_check')!
}
function toolExecution(agent: Agent, callId = 'call-check'): ToolExecution {
  return { name: 'hephi_check', arguments: { checkId: 'build' }, callId, rootCallId: callId, token: Symbol('check') as never, agent } as unknown as ToolExecution
}

describe('A3 trust boundary: environment is not an enable channel', () => {
  it('TB-01: the runner ignores a Worker-inherited env switch; only an explicit option enables resolutions', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    await resolveRun(x, unknown)
    vi.stubEnv(ENV_SWITCH, '1')
    await expect(execute(x)).rejects.toThrow(/operator resolution/)
    // Only the host plugin config (explicit option) reaches runCheck.
    expect((await execute(x, 0, { allowOperatorResolutions: true })).status).toBe('passed')
  })

  it('TB-02: the verifier ignores the env switch; only an explicit option enables resolutions', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    await resolveRun(x, unknown)
    vi.stubEnv(ENV_SWITCH, '1')
    const off = await createEvidenceVerifier({ stateDir: x.stateDir })(x.c, ready(x.r.dir))
    expect(off.ok).toBe(false)
    if (!off.ok) expect(off.reason).toContain('unfinished/unsupported check execution')
    const on = await createEvidenceVerifier({ stateDir: x.stateDir, allowOperatorResolutions: true })(x.c, ready(x.r.dir))
    expect(on.ok).toBe(false)
    // The resolved run is still not passing evidence; it only stopped blocking.
    if (!on.ok) expect(on.reason).toContain('missing, failed or stale evidence')
  })
})

describe('A3 trust boundary: CLI operator config file', () => {
  it('TB-03: env-only (including HEPHI_ALLOW_OPERATOR_RESOLUTIONS=1) does not enable the CLI', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const envOnly = await cli(resolveArgs(x.stateDir, unknown.runId), operatorEnv({ [ENV_SWITCH]: '1' }))
    expect(envOnly.code).not.toBe(0)
    expect(envOnly.err).toContain('operator resolutions are disabled')
    expect(envOnly.err).toContain('--operator-config')
    await noResolutions(x)
    // A config *path* in the operator shell environment is allowed, but a missing path still fails.
    const missing = await cli(resolveArgs(x.stateDir, unknown.runId), operatorEnv({ HEPHI_OPERATOR_CONFIG: join(x.stateDir, 'nope.json') }))
    expect(missing.code).not.toBe(0)
    await noResolutions(x)
  })

  it('TB-04: a mode-0600 config with allowOperatorResolutions=true enables resolve (run-unblock and retry-reset)', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const config = await operatorConfig()
    const implicit = await cli(resolveArgs(x.stateDir, unknown.runId), operatorEnv({ HEPHI_OPERATOR_CONFIG: config }))
    expect(implicit.code).toBe(0)
    expect(implicit.out).toContain('HEPHI resolution recorded')
    expect(await readResolutions(x.stateDir, TICKET)).toHaveLength(1)
    // retry-reset compatibility with the same gate.
    const y = await fixture()
    for (let attempt = 0; attempt < 3; attempt += 1) await execute(y, 1)
    const reset = await cli([
      'resolve', '--kind', 'retry-reset', '--ticket', TICKET, '--check', 'build', '--basis', 'host-terminal',
      '--status', 'terminated', '--host-query', 'reviewed', '--operator', 'operator-a', '--state-dir', y.stateDir,
      '--operator-config', config,
    ], operatorEnv())
    expect(reset.code).toBe(0)
    expect(reset.out).toContain('HEPHI retry reset recorded')
    expect((await readResolutions(y.stateDir, TICKET))[0]).toMatchObject({ kind: 'retry-reset', checkId: 'build' })
  })

  it('TB-05: a config readable by group/other is refused (0644/0640) and writes nothing', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    for (const mode of [0o644, 0o640]) {
      const config = await operatorConfig(undefined, mode)
      const result = await cli(resolveArgs(x.stateDir, unknown.runId), operatorEnv({ HEPHI_OPERATOR_CONFIG: config }))
      expect(result.code).not.toBe(0)
      expect(result.err).toContain('group/other')
      expect(result.err).toContain('0600')
    }
    await noResolutions(x)
  })

  it('TB-06: missing, disabled (false) or invalid configs are refused and write nothing', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    const cases = [
      await operatorConfig({ allowOperatorResolutions: false }),
      await operatorConfig('{ not json'),
      await operatorConfig({ allowOperatorResolutions: 'true' }),
      join(x.stateDir, 'missing.json'),
    ]
    for (const config of cases) {
      const result = await cli(resolveArgs(x.stateDir, unknown.runId), operatorEnv({ HEPHI_OPERATOR_CONFIG: config }))
      expect(result.code).not.toBe(0)
      expect(result.err).toContain('operator resolutions are disabled')
    }
    await noResolutions(x)
  })
})

describe('A3 trust boundary: plugin config passthrough', () => {
  it('TB-07: mountWorkerGate passes allowOperatorResolutions and retryLimit to runCheck', async () => {
    const x = await fixture()
    const unknown = await seedUnknown(x)
    await resolveRun(x, unknown)
    // allowOperatorResolutions: false (default) -> the unresolved run still blocks.
    const off = fakeAgent(x.r.dir)
    const offMount = (await import('../../src/control/worker-mount.js')).mountWorkerGate({} as Context, off.agent, { stateDir: x.stateDir })!
    try {
      await expect(checkTool(off.registered).execute({ checkId: 'build' }, toolExecution(off.agent))).rejects.toThrow(/operator resolution/)
    } finally { offMount.dispose() }
    // Host config true -> the resolution is consumed by hephi_check.
    const on = fakeAgent(x.r.dir)
    const onMount = (await import('../../src/control/worker-mount.js')).mountWorkerGate({} as Context, on.agent, { stateDir: x.stateDir, allowOperatorResolutions: true })!
    try {
      const record = await checkTool(on.registered).execute({ checkId: 'build' }, toolExecution(on.agent))
      expect(record.status).toBe('passed')
    } finally { onMount.dispose() }
    // retryLimit passthrough: C4.5 limit 1 is enforced by the mounted check tool.
    const y = await fixture()
    const limited = fakeAgent(y.r.dir, 1)
    const limitMount = (await import('../../src/control/worker-mount.js')).mountWorkerGate({} as Context, limited.agent, { stateDir: y.stateDir, retryLimit: 1 })!
    try {
      expect((await checkTool(limited.registered).execute({ checkId: 'build' }, toolExecution(limited.agent))).status).toBe('blocked')
      await expect(checkTool(limited.registered).execute({ checkId: 'build' }, toolExecution(limited.agent, 'call-check-2'))).rejects.toThrow(/retry limit/)
    } finally { limitMount.dispose() }
  })

  it('TB-08: apply(ctx, config) is the only plugin-side switch; env and invalid retryLimit are handled', async () => {
    vi.stubEnv(ENV_SWITCH, '1')
    const x = await fixture()
    const unknown = await seedUnknown(x)
    await resolveRun(x, unknown)
    const fake = fakeAgent(x.r.dir)
    const ctx = {
      get: () => undefined,
      on: () => () => true,
      effect: (fn: () => (() => void) | void) => { fn() },
      agents: { list: () => [fake.agent] },
    } as unknown as Context
    apply(ctx, { stateDir: x.stateDir })
    try {
      // Worker-inherited env is inert: without the host config the check stays blocked.
      await expect(checkTool(fake.registered).execute({ checkId: 'build' }, toolExecution(fake.agent))).rejects.toThrow(/operator resolution/)
    } finally { /* no disposer exposed here */ }
    // The same apply path with the host config enables it.
    const onFake = fakeAgent(x.r.dir)
    const onCtx = {
      get: () => undefined, on: () => () => true, effect: (fn: () => (() => void) | void) => { fn() }, agents: { list: () => [onFake.agent] },
    } as unknown as Context
    apply(onCtx, { stateDir: x.stateDir, allowOperatorResolutions: true })
    expect((await checkTool(onFake.registered).execute({ checkId: 'build' }, toolExecution(onFake.agent))).status).toBe('passed')
    // Invalid host config fails closed at apply() time.
    expect(() => apply({ ...onCtx } as Context, { stateDir: x.stateDir, retryLimit: 0 })).toThrow(/positive integer/)
  })
})
