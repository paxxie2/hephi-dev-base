import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sessionBindingPolicy, verificationOf, type ActivationContract } from './activation.js'
import type { ReadyVerifier } from './ready-gate.js'
import { gitFingerprint, sha256 } from '../verification/fingerprint.js'
import { clean, defaultPullRequest, hasCommit, normalizeRepository, remoteRepository, type PullRequestInfo } from './repository.js'
import { resolveWorkspace } from './workspace.js'
import { requireKnowledgeQuery } from '../kb/index.js'
import { checkRunDir, operatorResolutionsAllowed, readRuns, resolvedRunIds, type CheckRunRecord } from './check-store.js'
import { checkCommand, contained, sameSource, type NativeJobView, type NativeJobs } from './check-runner.js'
import { checkDiscipline } from './discipline.js'
import { pluginCommit } from '../version.js'
import { logDecision } from './decision-log.js'

/**
 * The host's Session snapshot, in the shape stage recovery already reads
 * (`sessionQuery.readSession`). Whether hephi_check's inner bash calls are
 * recorded there has not been verified on a real host.
 */
export type SessionSnapshot = {
  session: { id: string }
  inheritedEventCount: number
  events: Array<{ seq: number; type: string; data: any }>
}
export type SessionReader = (sessionId: string) => Promise<SessionSnapshot>

function argumentsOf(data: any): any {
  if (typeof data?.arguments !== 'string') return data?.arguments
  try { return JSON.parse(data.arguments) } catch { return undefined }
}

/**
 * Native bash result value carried by a Session `tool/result` message.
 * FI-FIXME(H2): the host shape of this structured value (field name, exit-code form,
 * foreground/promoted kinds, truncation flags) has not been confirmed on a real host.
 */
type NativeResultValue = {
  kind?: string
  jobId?: string
  exitCode?: number
  timedOut?: boolean
  aborted?: boolean
  signal?: string | null
  stdout?: { text?: string; truncated?: boolean }
  stderr?: { text?: string; truncated?: boolean }
}

/** Host `jobs.readAt` projection. Mirrored structurally because check-runner keeps its type private. */
type NativeJobReadView = { chunks: readonly { at: number; text: string }[]; lossy: boolean }

/**
 * Exit code in the documented host Job detail form (`exit code: <n>[; ...]`).
 * MUST stay byte-compatible with check-runner's private reader; H3 confirms the real format.
 */
function jobDetailExitCode(detail: string | undefined): number | undefined {
  if (detail === undefined) return undefined
  const match = /^exit code: (-?\d+)(?:;|$)/.exec(detail)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : undefined
}

/** One record's native evidence, reconstructed from the Session snapshot only (never from run.json). */
type NativeEvidence = {
  /** The evidence is not bound to a genuine native execution, or the Job terminal state is wrong. */
  bindingProblem?: string
  /** The Job terminal state cannot be read at ready time (cleared, foreign Session, no registry). */
  jobUnavailable?: string
  /** A1-OUT: the authoritative output cannot be reconstructed (truncated, lossy, cleared). */
  outputProblem?: string
  /** A1-OUT: authoritative output text when it can be reconstructed. */
  output?: string
}

const truncated = (part: { truncated?: boolean } | undefined): boolean => part?.truncated === true

/**
 * A1-BIND: reconstruct the native execution from the Session snapshot, using the contract's
 * frozen check definition (command, args, cwd) and the Session's structured result value.
 * A1-OUT: return the authoritative output so the verifier can re-hash it.
 *
 * FI-FIXME(H1-H5): the exact host encodings are pending the host probes:
 * H1 (tool/call arguments string and workdir), H2 (structured result value / exit-code form),
 * H3 (Job terminal view, detail exit-code format), H3a (jobs.readAt chunks and `lossy`),
 * H5 (inherited event count). Fixture-tested only until then.
 */
async function analyzeNativeEvidence(
  snapshot: SessionSnapshot, sessionId: string, contract: ActivationContract, record: CheckRunRecord,
  workspace: string, jobs: NativeJobs | undefined,
): Promise<NativeEvidence> {
  if (snapshot.session?.id !== sessionId) return { bindingProblem: 'Session snapshot belongs to a different Session' }
  const own = snapshot.events.filter(event => event.seq >= snapshot.inheritedEventCount)
  // The expected command and directory come from the frozen contract, not from the record's argv/cwd.
  const definition = verificationOf(contract).checks.find(check => check.id === record.checkId)
  if (!definition) return { bindingProblem: `${record.checkId}: no frozen check definition in the contract` }
  let expectedCommand: string
  let expectedCwd: string
  try {
    expectedCommand = checkCommand(contract.baseSha, definition.command, definition.args)
    expectedCwd = await contained(workspace, definition.cwd)
  } catch (error) {
    return { bindingProblem: `${record.checkId}: cannot resolve the frozen check command or directory: ${error instanceof Error ? error.message : String(error)}` }
  }
  const calls = own.filter(event => event.type === 'tool/call' && event.data?.callId === record.innerCallId)
  if (calls.length !== 1) return { bindingProblem: `${record.checkId}: expected one native call ${record.innerCallId} in this Session, found ${calls.length}` }
  const call = calls[0].data
  if (call.name !== 'bash') return { bindingProblem: `${record.checkId}: Session call ${record.innerCallId} is ${String(call.name)}, not bash` }
  const args = argumentsOf(call)
  // Exact string comparison: the shell command is never parsed or normalised.
  if (args?.command !== expectedCommand || args?.workdir !== expectedCwd) {
    return { bindingProblem: `${record.checkId}: Session call ${record.innerCallId} ran a different command or directory` }
  }
  const results = own.filter(event => event.type === 'tool/result' && event.data?.message?.toolCallId === record.innerCallId)
  if (results.length !== 1) return { bindingProblem: `${record.checkId}: expected one result for ${record.innerCallId} in this Session, found ${results.length}` }
  const message = results[0].data.message
  if (message.isError !== false) return { bindingProblem: `${record.checkId}: Session result for ${record.innerCallId} is an error` }
  const value = message.value as NativeResultValue | undefined
  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    return { bindingProblem: `${record.checkId}: Session result for ${record.innerCallId} carries no structured native value` }
  }
  // Branch on the Session result kind, never on the presence of record.jobId.
  if (value.kind === 'foreground') {
    if (record.jobId !== undefined) return { bindingProblem: `${record.checkId}: foreground Session result but the record names a Job` }
    if (!Number.isInteger(value.exitCode)) return { bindingProblem: `${record.checkId}: foreground Session result has no exit code` }
    if (value.timedOut === true || value.aborted === true || value.signal != null) {
      return { bindingProblem: `${record.checkId}: foreground Session result was cancelled or timed out` }
    }
    if (value.exitCode !== record.exitCode) {
      return { bindingProblem: `${record.checkId}: Session result exit code ${String(value.exitCode)} differs from the record` }
    }
    if (value.exitCode !== 0) return { bindingProblem: `${record.checkId}: foreground Session result exit code ${String(value.exitCode)} does not confirm a successful check` }
    if (truncated(value.stdout) || truncated(value.stderr)) return { outputProblem: `${record.checkId}: foreground Session output was truncated` }
    // The runner persisted `${stdout.text}\n${stderr.text}`; mirror that form exactly.
    return { output: `${value.stdout?.text ?? ''}\n${value.stderr?.text ?? ''}` }
  }
  if (value.kind === 'promoted' || value.kind === 'background') {
    if (typeof record.jobId !== 'string' || record.jobId === '') {
      return { bindingProblem: `${record.checkId}: Session result is ${value.kind} but the record names no Job` }
    }
    if (value.jobId !== record.jobId) {
      return { bindingProblem: `${record.checkId}: Session result Job ${String(value.jobId)} differs from the recorded Job ${record.jobId}` }
    }
    if (!jobs) return { jobUnavailable: `${record.checkId}: Job terminal state is unavailable (host Job registry is not mounted)` }
    let view: NativeJobView | undefined
    try { view = jobs.get(record.jobId, sessionId) } catch { view = undefined }
    if (!view || typeof view.status !== 'string') {
      return { jobUnavailable: `${record.checkId}: Job terminal state is unavailable (Job ${record.jobId} is cleared or belongs to another Session)` }
    }
    if (view.status !== 'completed') return { bindingProblem: `${record.checkId}: Job ${record.jobId} terminal status is ${view.status}` }
    const code = jobDetailExitCode(view.detail)
    if (code === undefined) return { bindingProblem: `${record.checkId}: Job ${record.jobId} detail is not the documented exit-code form` }
    if (code !== 0 || record.exitCode !== 0) {
      return { bindingProblem: `${record.checkId}: Job ${record.jobId} exit code ${code} does not confirm a successful check` }
    }
    let read: NativeJobReadView | undefined
    try { read = jobs.readAt(record.jobId, 0, sessionId) as NativeJobReadView } catch { read = undefined }
    if (!read || !Array.isArray(read.chunks) || typeof read.lossy !== 'boolean'
      || read.chunks.some(chunk => !chunk || typeof chunk.at !== 'number' || typeof chunk.text !== 'string')) {
      return { outputProblem: `${record.checkId}: Job ${record.jobId} output is not readable` }
    }
    if (read.lossy) return { outputProblem: `${record.checkId}: Job ${record.jobId} output was lost (lossy)` }
    return { output: read.chunks.map(chunk => chunk.text).join('') }
  }
  return { bindingProblem: `${record.checkId}: unsupported Session result kind ${value.kind}` }
}

/**
 * A record is bound only to this Session's own bash call matching the frozen check, with a
 * successful Session result (foreground exit 0, or a completed Job with exit 0).
 * Returns the first binding problem, if any; Job-unavailable and output problems are covered
 * by `analyzeNativeEvidence` for the verifier's A1-OUT pass.
 */
export async function sessionBindingProblem(
  snapshot: SessionSnapshot, sessionId: string, contract: ActivationContract, record: CheckRunRecord,
  context: { workspace: string; jobs?: NativeJobs },
): Promise<string | undefined> {
  const evidence = await analyzeNativeEvidence(snapshot, sessionId, contract, record, context.workspace, context.jobs)
  return evidence.bindingProblem ?? evidence.jobUnavailable
}

/**
 * Evidence must match the frozen check definition even when Session binding is off:
 * a record for another command or another directory is not evidence for this check.
 */
async function frozenCheckProblem(contract: ActivationContract, record: CheckRunRecord, workspace: string): Promise<string | undefined> {
  const definition = verificationOf(contract).checks.find(check => check.id === record.checkId)
  if (!definition) return `${record.checkId}: no frozen check definition in the contract`
  const expected = [definition.command, ...definition.args]
  if (record.argv.length !== expected.length || record.argv.some((value, index) => value !== expected[index])) {
    return `${record.checkId}: recorded argv differs from the frozen check`
  }
  if (record.cwd !== await contained(workspace, definition.cwd)) {
    return `${record.checkId}: recorded working directory differs from the frozen check`
  }
  return undefined
}

export function createEvidenceVerifier(options: {
  stateDir: string
  pullRequest?: (repo: string, n: number) => Promise<PullRequestInfo>
  readSession?: SessionReader
  /**
   * Host configuration only (cordis.patch.yml / environment). The effective requirement is
   * this OR the contract's frozen `evidence.requireSessionBinding`: host config can tighten
   * the contract but never relax it (A1-K5). Contracts written before version 3 have no
   * frozen value, so for them this is the only source.
   */
  requireSessionBinding?: boolean
  /**
   * A3: operator resolutions for unfinished (`running`/`unknown`) runs. Disabled unless the
   * host operator enables it (A3 trust boundary); a resolution only restores the right to
   * re-run the check — it never turns the old execution into passing evidence.
   */
  allowOperatorResolutions?: boolean
  /**
   * Host `ctx.jobs` registry, used by A1-BIND to confirm a background check's terminal state
   * and by A1-OUT to read its authoritative output. Missing registry means background
   * evidence cannot be verified (ready denies) rather than silently trusting the record.
   */
  jobs?: NativeJobs
}): ReadyVerifier {
  if (options.requireSessionBinding && !options.readSession) throw new Error('Session binding requires a Session reader')
  const verify = async (contract: ActivationContract, execution: Parameters<ReadyVerifier>[1]): ReturnType<ReadyVerifier> => {
    try {
      const binding = sessionBindingPolicy(contract, options.requireSessionBinding === true)
      const verification = verificationOf(contract)
      await requireKnowledgeQuery(contract, options.stateDir)
      const workspace = await resolveWorkspace(contract.workspace, execution.agent?.session.header.cwd)
      if (normalizeRepository(await remoteRepository(workspace)) !== normalizeRepository(contract.repository)
        || !await hasCommit(workspace, contract.baseSha) || !await clean(workspace)) throw new Error('repository/base/clean check failed')
      const before = await gitFingerprint(workspace, contract.baseSha)
      if (!before.changedFiles.length) throw new Error('missing patch or path outside contract')
      await checkDiscipline(contract, workspace)
      if (contract.plugin !== undefined && contract.plugin.commit !== pluginCommit()) {
        throw new Error(`contract was prepared by another plugin build (${contract.plugin.commit}); rerun prepare with ${pluginCommit()}`)
      }
      const records = await readRuns(options.stateDir, contract.ticketId)
      const allowResolutions = options.allowOperatorResolutions ?? operatorResolutionsAllowed()
      const resolved = allowResolutions
        ? await resolvedRunIds(options.stateDir, contract.ticketId, contract.contractHash)
        : new Set<string>()
      if (records.some(r => (r.status === 'unknown' || r.status === 'running') && !resolved.has(r.runId))) {
        throw new Error('unfinished/unsupported check execution; operator resolution required')
      }
      // Required checks plus every check an acceptance item names, each verified once.
      const needed = new Set(verification.checks.filter(c => c.required).map(c => c.id))
      for (const item of contract.task?.acceptance ?? []) needed.add(item.check)
      const used: CheckRunRecord[] = []
      for (const id of needed) {
        const r = records.filter(r => r.checkId === id).at(-1)
        if (!r || r.status !== 'passed' || r.exitCode !== 0 || r.contractHash !== contract.contractHash
          || !r.sessionId || !r.callId || !r.innerCallId || !r.finishedAt
          || !sameSource(r.before, before) || !sameSource(r.after, before)) throw new Error(`missing, failed or stale evidence: ${id}`)
        if (sha256(await readFile(join(checkRunDir(options.stateDir, contract.ticketId, r.runId), 'output.log'))) !== r.outputHash) throw new Error('output hash mismatch')
        const frozen = await frozenCheckProblem(contract, r, workspace)
        if (frozen) throw new Error(`evidence does not match the frozen check: ${frozen}`)
        if (r.pluginCommit !== pluginCommit()) throw new Error(`check evidence was produced by another plugin build (${r.pluginCommit}); rerun checks with ${pluginCommit()}`)
        used.push(r)
      }
      // A1-K4: the evidence must name this Worker Session, not merely a non-empty id.
      // This runs regardless of the binding switch (the defect was that the binding-off
      // path had no such constraint); a ready report without a Session id fails closed
      // because ownership cannot be proven. Which host id ends up in check records is
      // still pending the H4 host probe.
      const reportSessionId = execution.agent?.session.header.id
      const sessionId = reportSessionId === undefined || reportSessionId === null || reportSessionId === ''
        ? undefined
        : String(reportSessionId)
      if (sessionId === undefined) throw new Error('ready report has no Worker Session; evidence cannot be bound')
      for (const r of used) {
        if (r.sessionId !== sessionId) {
          throw new Error(`evidence is not bound to a native execution: ${r.checkId}: check record belongs to Session "${r.sessionId}" but the current Worker Session is "${sessionId}"`)
        }
      }
      if (binding.effective) {
        if (!options.readSession) throw new Error('Session binding requires a Session reader')
        // The Session snapshot carries the native call/result evidence; reading it after
        // the ownership check keeps a missing sessionQuery from masking a foreign record.
        const snapshot = await options.readSession(sessionId)
        for (const r of used) {
          const evidence = await analyzeNativeEvidence(snapshot, sessionId, contract, r, workspace, options.jobs)
          if (evidence.jobUnavailable) throw new Error(`evidence is not bound to a native execution: ${evidence.jobUnavailable}`)
          if (evidence.bindingProblem) throw new Error(`evidence is not bound to a native execution: ${evidence.bindingProblem}`)
          // A1-OUT: the record's output hash must also match the authoritative Session/Job
          // output. Unavailable authoritative output is a denial, never a silent downgrade.
          if (evidence.outputProblem) throw new Error(`authoritative check output is unavailable: ${evidence.outputProblem}`)
          if (evidence.output === undefined) throw new Error(`authoritative check output is unavailable: ${r.checkId}: no native output`)
          if (sha256(evidence.output) !== r.outputHash) throw new Error(`authoritative check output differs from the record: ${r.checkId}`)
        }
      }
      if (contract.requirePullRequest) {
        const number = (execution.arguments as { pr_number?: number }).pr_number
        if (!Number.isInteger(number) || number! <= 0) throw new Error('pr_number required')
        const fetch = options.pullRequest ?? ((repo, n) => defaultPullRequest(repo, n, join(options.stateDir, 'worker-bin', 'gh')))
        const pr = await fetch(contract.repository, number!)
        if (pr.state !== 'open' || pr.baseRef !== contract.baseRef || pr.headSha !== before.headCommit) throw new Error('PR/base/HEAD mismatch')
      }
      if (!await clean(workspace) || !sameSource(before, await gitFingerprint(workspace, contract.baseSha))) throw new Error('source changed during ready')
      return { ok: true }
    } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) } }
  }
  return async (contract, execution) => {
    const result = await verify(contract, execution)
    const rule = result.ok ? 'ready.pass' : readyRule(result.reason)
    const sessionId = execution.agent?.session.header.id
    // A1-K5b: every ready decision records the policy actually in force (contract + host + effective).
    const binding = sessionBindingPolicy(contract, options.requireSessionBinding === true)
    await logDecision(options.stateDir, {
      ticketId: contract.ticketId,
      sessionId: sessionId === undefined || sessionId === null ? undefined : String(sessionId),
      callId: String(execution.callId),
      tool: 'orchestrator_report',
      mode: 'enforce',
      effectiveDecision: result.ok ? 'allow' : 'deny',
      wouldDecision: result.ok ? 'allow' : 'deny',
      rule,
      reason: result.ok ? undefined : result.reason,
      contractHash: contract.contractHash,
      binding,
    })
    return result
  }
}

/** Stable rule ids for ready denials; P3 aggregates by rule. */
function readyRule(reason: string): string {
  // A1-BIND/A1-OUT: an unreadable Job terminal state or unverifiable output is not a
  // generic binding mismatch; keep them distinguishable for P3 aggregation.
  if (reason.includes('Job terminal state is unavailable')) return 'ready.job-unavailable'
  if (reason.includes('authoritative check output is unavailable') || reason.includes('authoritative check output differs')) return 'ready.output-unverified'
  if (reason.includes('not bound to a native execution')) return 'ready.binding'
  if (reason.includes('PR/base/HEAD mismatch')) return 'ready.pr-mismatch'
  if (reason.includes('missing, failed or stale evidence')) return 'ready.evidence-missing'
  if (reason.includes('contract was prepared by another plugin build')) return 'ready.plugin-build'
  return 'ready.other'
}
