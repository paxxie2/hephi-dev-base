import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sessionBindingPolicy, verificationOf, type ActivationContract } from './activation.js'
import type { ReadyVerifier } from './ready-gate.js'
import { gitFingerprint, sha256 } from '../verification/fingerprint.js'
import { clean, defaultPullRequest, hasCommit, normalizeRepository, remoteRepository, type PullRequestInfo } from './repository.js'
import { resolveWorkspace } from './workspace.js'
import { requireKnowledgeQuery } from '../kb/index.js'
import { checkRunDir, operatorResolutionsAllowed, readRuns, resolvedRunIds, type CheckRunRecord } from './check-store.js'
import { checkCommand, contained, sameSource } from './check-runner.js'
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

/** Exit code reported in a bash tool result, when the result carries one. */
function resultExitCode(message: any): number | undefined {
  for (const part of message?.content ?? []) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue
    try {
      const value = JSON.parse(part.text)
      if (Number.isInteger(value?.exitCode)) return value.exitCode
    } catch { /* not a JSON result */ }
  }
  return undefined
}

/** A record is bound only to this Session's own bash call with the same command, directory and a successful result. */
export function sessionBindingProblem(snapshot: SessionSnapshot, sessionId: string, contract: ActivationContract, record: CheckRunRecord): string | undefined {
  if (snapshot.session?.id !== sessionId) return 'Session snapshot belongs to a different Session'
  const own = snapshot.events.filter(event => event.seq >= snapshot.inheritedEventCount)
  const calls = own.filter(event => event.type === 'tool/call' && event.data?.callId === record.innerCallId)
  if (calls.length !== 1) return `${record.checkId}: expected one native call ${record.innerCallId} in this Session, found ${calls.length}`
  const call = calls[0].data
  const args = argumentsOf(call)
  if (call.name !== 'bash') return `${record.checkId}: Session call ${record.innerCallId} is ${String(call.name)}, not bash`
  const [command, ...rest] = record.argv
  if (args?.command !== checkCommand(contract.baseSha, command, rest) || args?.workdir !== record.cwd) return `${record.checkId}: Session call ${record.innerCallId} ran a different command or directory`
  const results = own.filter(event => event.type === 'tool/result' && event.data?.message?.toolCallId === record.innerCallId)
  if (results.length !== 1) return `${record.checkId}: expected one result for ${record.innerCallId} in this Session, found ${results.length}`
  const message = results[0].data.message
  if (message.isError !== false) return `${record.checkId}: Session result for ${record.innerCallId} is an error`
  const exitCode = resultExitCode(message)
  if (exitCode !== undefined && exitCode !== record.exitCode) return `${record.checkId}: Session result exit code ${exitCode} differs from the record`
  return undefined
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
          const problem = sessionBindingProblem(snapshot, sessionId, contract, r)
          if (problem) throw new Error(`evidence is not bound to a native execution: ${problem}`)
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
  if (reason.includes('not bound to a native execution')) return 'ready.binding'
  if (reason.includes('PR/base/HEAD mismatch')) return 'ready.pr-mismatch'
  if (reason.includes('missing, failed or stale evidence')) return 'ready.evidence-missing'
  if (reason.includes('contract was prepared by another plugin build')) return 'ready.plugin-build'
  return 'ready.other'
}
