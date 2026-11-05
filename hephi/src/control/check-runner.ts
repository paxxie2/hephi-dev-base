import { copyFile, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolExecution, ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { frozenTestDir, verificationOf, type ActivationContract } from './activation.js'
import type { VerificationCheck } from '../contracts/checks.js'
import { gitFingerprint, sha256, type RepositoryFingerprint } from '../verification/fingerprint.js'
import { allowedPath, clean, hasCommit, normalizeRepository, remoteRepository } from './repository.js'
import { resolveWorkspace } from './workspace.js'
import { checkRunDir, readRuns, saveRun, type CheckRunRecord } from './check-store.js'
import { inScope } from './discipline.js'

const exec = promisify(execFile)

export type CheckTools = { execute(input: ToolExecutionInput): Promise<ToolExecutionResult> }

/** Public projection of one native background Job; only what a check reads. */
export type NativeJobView = {
  status: string
  detail?: string
}

type NativeJobRead = { chunks: readonly { at: number; text: string }[]; lossy: boolean }

/** Host-provided `ctx.jobs` surface; only the operations a check needs. */
export type NativeJobs = {
  get(id: string, caller?: string): NativeJobView
  wait(id: string, timeoutMs: number, caller?: string, signal?: AbortSignal): Promise<NativeJobView>
  readAt(id: string, from: number, caller?: string): NativeJobRead
  kill(id: string, caller?: string, reason?: string): 'requested' | 'already-finished'
}

const JOB_WAIT_MS = 30_000
const JOB_CONFIRM_MS = 15_000
const isTerminal = (status: string) => status === 'completed' || status === 'killed' || status === 'failed'
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
export function sameSource(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }
export async function contained(root: string, path: string): Promise<string> {
  const [base, actual] = await Promise.all([realpath(root), realpath(resolve(root, path))])
  if (actual !== base && !actual.startsWith(base + sep)) throw new Error('path escapes declared directory')
  return actual
}

function jobExitCode(detail: string | undefined): number | undefined {
  if (detail === undefined) return undefined
  const match = /^exit code: (-?\d+)(?:;|$)/.exec(detail)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : undefined
}

async function readJobOutput(jobs: NativeJobs, jobId: string, sessionId: string): Promise<string> {
  const read = jobs.readAt(jobId, 0, sessionId)
  if (!read || !Array.isArray(read.chunks) || typeof read.lossy !== 'boolean') {
    throw new Error('native Job readAt returned an unknown structure')
  }
  for (const chunk of read.chunks) {
    if (!chunk || typeof chunk.at !== 'number' || typeof chunk.text !== 'string') {
      throw new Error('native Job returned an unknown output chunk')
    }
  }
  if (read.lossy) throw new Error('native Job output was lost before it could be read')
  return read.chunks.map(chunk => chunk.text).join('')
}

/** Confirm that a killed Job reached a terminal status, using the remaining budget. */
async function confirmTerminal(jobs: NativeJobs, jobId: string, sessionId: string, maxMs: number): Promise<NativeJobView | undefined> {
  const end = Date.now() + maxMs
  while (Date.now() <= end) {
    let view: NativeJobView | undefined
    try {
      view = jobs.get(jobId, sessionId)
    } catch {
      return undefined
    }
    if (!view || typeof view.status !== 'string') return undefined
    if (isTerminal(view.status)) return view
    try {
      view = await jobs.wait(jobId, Math.max(1, Math.min(end - Date.now(), 1000)), sessionId)
    } catch {
      view = undefined
    }
    if (view && isTerminal(view.status)) return view
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return undefined
}

/** A native execution failure; `terminal` means the process is confirmed ended. */
class NativeRunError extends Error {
  constructor(message: string, readonly terminal: boolean) { super(message) }
}

type NativeRun = {
  tools: CheckTools; jobs?: NativeJobs; outer: ToolExecution; sessionId: string
  innerCallId: string; label: string; command: string; cwd: string; timeoutMs: number
  /** Persist the Job id before waiting, so a crash still identifies the execution. */
  onJob: (jobId: string) => Promise<void>
  /** Called for a confirmed stopped Job whose partial output is still readable. */
  onStoppedOutput: (output: string) => Promise<void>
}

/** Run one command through the host's native bash tool and settle it to an exit code. */
async function runNative(o: NativeRun): Promise<{ output: string; exitCode: number | null; jobFailure?: string }> {
  // The contract deadline covers the whole native execution, including a Job
  // that the host promotes or starts in the background.
  const deadline = Date.now() + o.timeoutMs
  const result = await o.tools.execute({ name: 'bash', callId: o.innerCallId as never, parent: o.outer.token,
    rootCallId: o.outer.callId, agent: o.outer.agent, signal: o.outer.signal,
    arguments: { description: o.label, command: o.command, workdir: o.cwd, timeoutMs: o.timeoutMs } })
  const value = result.value as { kind?: string; jobId?: string; exitCode?: number; timedOut?: boolean; aborted?: boolean; signal?: string | null;
    stdout?: { text?: string }; stderr?: { text?: string } } | undefined
  if (result.isError) throw new NativeRunError('native bash execution returned an error', false)

  if (value?.kind === 'foreground') {
    if (!Number.isInteger(value.exitCode) || value.timedOut || value.aborted || value.signal != null) {
      throw new NativeRunError('only a confirmed foreground result is supported; background/cancel/unknown requires operator resolution', false)
    }
    return { output: `${value.stdout?.text ?? ''}\n${value.stderr?.text ?? ''}`, exitCode: value.exitCode! }
  }
  if (value?.kind !== 'promoted' && value?.kind !== 'background') {
    throw new NativeRunError(`native bash returned unknown result kind: ${String(value?.kind)}`, false)
  }
  const jobId = value.jobId
  if (typeof jobId !== 'string' || !jobId) throw new NativeRunError(`native bash ${value.kind} result is missing its Job id`, false)
  await o.onJob(jobId)
  const jobs = o.jobs
  if (!jobs) throw new NativeRunError('native bash returned a background Job but the host Job registry is unavailable', false)
  let view: NativeJobView | undefined
  let timedOut = false
  let waitError: string | undefined
  while (true) {
    if (o.outer.signal.aborted) break
    const remaining = deadline - Date.now()
    if (remaining <= 0) { timedOut = true; break }
    try {
      const next = await jobs.wait(jobId, Math.min(remaining, JOB_WAIT_MS), o.sessionId, o.outer.signal)
      if (!next || typeof next.status !== 'string') throw new Error('native Job returned an unknown projection')
      if (isTerminal(next.status)) { view = next; break }
      if (next.status !== 'running' && next.status !== 'stopping' && next.status !== 'unknown') {
        throw new Error(`native Job returned unknown status: ${next.status}`)
      }
      // A single wait timeout is not contract completion: poll again until
      // the Job settles or the overall deadline expires.
    } catch (error) {
      if (!o.outer.signal.aborted) waitError = error instanceof Error ? error.message : String(error)
      break
    }
  }
  if (!view) {
    try {
      jobs.kill(jobId, o.sessionId, 'HEPHI check timeout or cancellation')
    } catch (error) {
      throw new NativeRunError(`native Job ${jobId} could not be stopped: ${error instanceof Error ? error.message : String(error)}`, false)
    }
    view = await confirmTerminal(jobs, jobId, o.sessionId, JOB_CONFIRM_MS)
    const stopReason = timedOut
      ? `check exceeded its contract deadline of ${o.timeoutMs}ms`
      : waitError !== undefined ? `native Job wait failed: ${waitError}` : 'check was cancelled'
    if (!view) throw new NativeRunError(`native Job ${jobId} termination is unconfirmed after ${stopReason}`, false)
    try {
      await o.onStoppedOutput(await readJobOutput(jobs, jobId, o.sessionId))
    } catch {
      // A confirmed stopped Job is blocked even when its output is gone.
    }
    throw new NativeRunError(stopReason, true)
  }
  let output: string
  try {
    output = await readJobOutput(jobs, jobId, o.sessionId)
  } catch (error) {
    throw new NativeRunError(error instanceof Error ? error.message : String(error), true)
  }
  if (view.status === 'completed') {
    const code = jobExitCode(view.detail)
    if (code === undefined) return { output, exitCode: null, jobFailure: `native Job detail is not the documented exit-code form: ${String(view.detail)}` }
    return { output, exitCode: code }
  }
  if (view.status === 'failed') {
    const code = jobExitCode(view.detail)
    if (code === undefined) return { output, exitCode: null, jobFailure: `native Job failed without a parseable exit code: ${String(view.detail)}` }
    return { output, exitCode: code, jobFailure: `native Job failed: ${view.detail}` }
  }
  return { output, exitCode: null, jobFailure: `native Job ${view.status}: ${view.detail ?? 'no detail'}` }
}

type CheckOptions = {
  stateDir: string; contract: ActivationContract; checkId: string; outer: ToolExecution;
  tools: CheckTools; jobs?: NativeJobs; sessionCwd?: string; internal?: (id?: string) => void;
}

/** Shared admission: no unsettled evidence, the bound checkout, a clean in-scope patch. */
async function admit(options: CheckOptions): Promise<{ workspace: string; before: RepositoryFingerprint; old: CheckRunRecord[] }> {
  const { contract, stateDir } = options
  const old = await readRuns(stateDir, contract.ticketId)
  if (old.some(r => r.status === 'running' || r.status === 'unknown')) throw new Error('unfinished/unsupported execution requires operator resolution; no automatic recovery')
  const workspace = await resolveWorkspace(contract.workspace, options.sessionCwd)
  if (normalizeRepository(await remoteRepository(workspace)) !== normalizeRepository(contract.repository)
    || !await hasCommit(workspace, contract.baseSha) || !await clean(workspace)) throw new Error('repository/base/clean check failed')
  const before = await gitFingerprint(workspace, contract.baseSha)
  if (before.changedFiles.some(p => !inScope(contract, p))) throw new Error('changed path outside contract')
  return { workspace, before, old }
}

function commandFor(contract: ActivationContract, check: VerificationCheck): string {
  return `HEPHI_BASE_COMMIT=${quote(contract.baseSha)} ` + [check.command, ...check.args].map(quote).join(' ')
}

export async function runCheck(options: CheckOptions): Promise<CheckRunRecord> {
  const { contract, stateDir, outer } = options
  if (contract.task?.acceptance.some(item => item.id === options.checkId)) return runAcceptance(options)
  const check = verificationOf(contract).checks.find(c => c.id === options.checkId)
  if (!check) throw new Error('unknown checkId or missing frozen verification contract')
  const { workspace, before, old } = await admit(options)
  const cwd = await contained(workspace, check.cwd)
  const runId = randomUUID(), innerCallId = `hephi-${randomUUID()}`
  const dir = checkRunDir(stateDir, contract.ticketId, runId)
  await mkdir(dir, { recursive: true })
  const command = commandFor(contract, check)
  const record: CheckRunRecord = {
    version: 2, runId, sequence: (old.at(-1)?.sequence ?? 0) + 1, ticketId: contract.ticketId,
    contractHash: contract.contractHash, checkId: check.id,
    sessionId: String(outer.agent?.id ?? ''), callId: outer.callId, innerCallId,
    argv: [check.command, ...check.args], cwd, startedAt: new Date().toISOString(),
    status: 'running', exitCode: null, before,
  }
  await saveRun(stateDir, record)
  let terminal = false
  try {
    options.internal?.(innerCallId)
    let settled
    try {
      settled = await runNative({ tools: options.tools, jobs: options.jobs, outer, sessionId: record.sessionId, innerCallId,
        label: `HEPHI ${check.id}`, command, cwd, timeoutMs: check.timeoutMs,
        onJob: async jobId => { record.jobId = jobId; await saveRun(stateDir, record) },
        onStoppedOutput: async output => { await writeFile(join(dir, 'output.log'), output); record.outputHash = sha256(output) } })
    } catch (error) {
      if (error instanceof NativeRunError && error.terminal) { terminal = true; record.exitCode = null }
      throw error
    }
    terminal = true
    // One terminal path for foreground and Job results: persist the real
    // output and exit code before the existing source checks decide passing.
    await writeFile(join(dir, 'output.log'), settled.output)
    record.outputHash = sha256(settled.output)
    record.exitCode = settled.exitCode
    if (settled.jobFailure) throw new Error(settled.jobFailure)
    if (settled.exitCode === null) throw new Error('native execution did not report an exit code')
    if (settled.exitCode !== 0) throw new Error(`check did not exit successfully: ${settled.exitCode}`)
    record.after = await gitFingerprint(workspace, contract.baseSha)
    if (!await clean(workspace) || !sameSource(before, record.after)) throw new Error('source changed during check')
    record.status = 'passed'
  } catch (error) {
    record.status = terminal ? 'blocked' : 'unknown'
    record.reason = error instanceof Error ? error.message : String(error)
  } finally {
    options.internal?.()
    record.finishedAt = new Date().toISOString()
    await saveRun(stateDir, record)
  }
  return record
}

const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout.trim()

/** Copy files into a proof tree, refusing any path that would escape it. */
async function overlay(root: string, files: Array<{ path: string; from: string }>): Promise<void> {
  for (const file of files) {
    const target = resolve(root, file.path)
    if (!target.startsWith(root + sep)) throw new Error(`proof file escapes the proof tree: ${file.path}`)
    await mkdir(dirname(target), { recursive: true })
    await rm(target, { force: true, recursive: true })
    await copyFile(file.from, target)
  }
}

/**
 * Prove one acceptance item in two throwaway worktrees with the same check:
 * HEAD plus frozen tests must pass, and the base commit plus frozen tests and
 * the Worker's matching tests must fail. A pass on base means the tests do not
 * demonstrate the requested change.
 */
export async function runAcceptance(options: CheckOptions): Promise<CheckRunRecord> {
  const { contract, stateDir, outer } = options
  const item = contract.task!.acceptance.find(a => a.id === options.checkId)!
  const verification = verificationOf(contract)
  const check = verification.checks.find(c => c.id === item.check)
  if (!check) throw new Error(`acceptance ${item.id} refers to unknown check ${item.check}`)
  const { workspace, before, old } = await admit(options)
  const frozenRoot = frozenTestDir(stateDir, contract.ticketId)
  const frozen: Array<{ path: string; from: string }> = []
  for (const file of item.frozen) {
    const from = join(frozenRoot, file.path)
    if (sha256(await readFile(from)) !== file.sha256) throw new Error(`frozen acceptance test changed: ${file.path}`)
    frozen.push({ path: file.path, from })
  }
  const workerTests = before.changedFiles.filter(f => allowedPath(f, item.tests))
    .map(path => ({ path, from: join(workspace, path) }))
  const runId = randomUUID()
  const dir = checkRunDir(stateDir, contract.ticketId, runId)
  await mkdir(dir, { recursive: true })
  const record: CheckRunRecord = {
    version: 2, runId, sequence: (old.at(-1)?.sequence ?? 0) + 1, ticketId: contract.ticketId,
    contractHash: contract.contractHash, checkId: check.id, acceptanceId: item.id,
    sessionId: String(outer.agent?.id ?? ''), callId: outer.callId, innerCallId: `hephi-${randomUUID()}`,
    baseInnerCallId: `hephi-${randomUUID()}`, proofFiles: [...frozen.map(f => f.path), ...workerTests.map(f => f.path)],
    argv: [check.command, ...check.args], cwd: check.cwd, startedAt: new Date().toISOString(),
    status: 'running', exitCode: null, before,
  }
  await saveRun(stateDir, record)
  const trees: string[] = []
  let terminal = false
  try {
    if (!frozen.length && !workerTests.length) {
      terminal = true
      throw new Error(`acceptance ${item.id} has no proof: add or change a test matching ${item.tests.join(', ')}`)
    }
    const proof = async (phase: 'head' | 'base', sha: string, files: typeof frozen, innerCallId: string) => {
      const tree = join(dir, phase)
      trees.push(tree)
      await git(workspace, 'worktree', 'add', '--detach', tree, sha)
      const root = await realpath(tree)
      for (const link of verification.proofLinks ?? []) {
        await mkdir(dirname(join(root, link)), { recursive: true })
        await rm(join(root, link), { force: true, recursive: true })
        await symlink(join(workspace, link), join(root, link))
      }
      await overlay(root, files)
      options.internal?.(innerCallId)
      try {
        const settled = await runNative({ tools: options.tools, jobs: options.jobs, outer, sessionId: record.sessionId, innerCallId,
          label: `HEPHI ${item.id} ${phase}`, command: commandFor(contract, check), cwd: await contained(root, check.cwd), timeoutMs: check.timeoutMs,
          onJob: async () => {}, onStoppedOutput: async () => {} })
        await writeFile(join(dir, `${phase}.log`), settled.output)
        if (settled.jobFailure && settled.exitCode === null) throw new NativeRunError(settled.jobFailure, true)
        return settled
      } catch (error) {
        if (error instanceof NativeRunError && error.terminal) terminal = true
        throw error
      }
    }
    const head = await proof('head', before.headCommit!, frozen, record.innerCallId)
    const base = await proof('base', contract.baseSha, [...frozen, ...workerTests], record.baseInnerCallId!)
    terminal = true
    const output = await readFile(join(dir, 'head.log'))
    await writeFile(join(dir, 'output.log'), output)
    record.outputHash = sha256(output)
    record.exitCode = head.exitCode
    record.baseExitCode = base.exitCode
    if (head.exitCode !== 0) throw new Error(`acceptance ${item.id} fails on HEAD: exit ${head.exitCode}`)
    if (base.exitCode === 0) throw new Error(`acceptance ${item.id} already passes on the base commit; its tests do not demonstrate the requested change`)
    record.after = await gitFingerprint(workspace, contract.baseSha)
    if (!await clean(workspace) || !sameSource(before, record.after)) throw new Error('source changed during check')
    record.status = 'passed'
  } catch (error) {
    record.status = terminal ? 'blocked' : 'unknown'
    record.reason = error instanceof Error ? error.message : String(error)
  } finally {
    options.internal?.()
    for (const tree of trees) await exec('git', ['worktree', 'remove', '--force', tree], { cwd: workspace }).catch(() => {})
    await exec('git', ['worktree', 'prune'], { cwd: workspace }).catch(() => {})
    record.finishedAt = new Date().toISOString()
    await saveRun(stateDir, record)
  }
  return record
}
