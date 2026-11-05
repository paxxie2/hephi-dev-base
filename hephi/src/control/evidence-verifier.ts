import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verificationOf } from './activation.js'
import type { ReadyVerifier } from './ready-gate.js'
import { gitFingerprint, sha256 } from '../verification/fingerprint.js'
import { clean, defaultPullRequest, hasCommit, normalizeRepository, remoteRepository, type PullRequestInfo } from './repository.js'
import { resolveWorkspace } from './workspace.js'
import { requireKnowledgeQuery } from '../kb/index.js'
import { checkRunDir, readRuns, type CheckRunRecord } from './check-store.js'
import { sameSource } from './check-runner.js'
import { checkDiscipline } from './discipline.js'

export type SessionEvent = { type: string; data: any }
/** Host-owned Session log of the Worker; evidence must name calls that appear in it. */
export type SessionEvents = (sessionId: string) => Promise<SessionEvent[]>

/** Call ids the host recorded for native executions: bash calls, their results and Job events. */
function nativeBashCalls(events: SessionEvent[]): Set<string> {
  const calls = new Set<string>()
  for (const { type, data } of events) {
    if (type === 'tool/call' && data?.name !== 'bash') continue
    for (const id of [data?.callId, data?.toolCallId, data?.message?.toolCallId]) if (typeof id === 'string') calls.add(id)
  }
  return calls
}

export function createEvidenceVerifier(options: {
  stateDir: string
  pullRequest?: (repo: string, n: number) => Promise<PullRequestInfo>
  sessionEvents?: SessionEvents
  requireSessionBinding?: boolean
}): ReadyVerifier {
  return async (contract, execution) => {
    try {
      const verification = verificationOf(contract)
      await requireKnowledgeQuery(contract, options.stateDir)
      const workspace = await resolveWorkspace(contract.workspace, execution.agent?.session.header.cwd)
      if (normalizeRepository(await remoteRepository(workspace)) !== normalizeRepository(contract.repository)
        || !await hasCommit(workspace, contract.baseSha) || !await clean(workspace)) throw new Error('repository/base/clean check failed')
      const before = await gitFingerprint(workspace, contract.baseSha)
      if (!before.changedFiles.length) throw new Error('missing patch or path outside contract')
      await checkDiscipline(contract, workspace)
      const records = await readRuns(options.stateDir, contract.ticketId)
      if (records.some(r => r.status === 'unknown' || r.status === 'running')) throw new Error('unfinished/unsupported check execution; operator resolution required')
      const used: CheckRunRecord[] = []
      const bound = async (r: CheckRunRecord | undefined, label: string): Promise<CheckRunRecord> => {
        if (!r || r.status !== 'passed' || r.exitCode !== 0 || r.contractHash !== contract.contractHash
          || !r.sessionId || !r.callId || !r.innerCallId || !r.finishedAt
          || !sameSource(r.before, before) || !sameSource(r.after, before)) throw new Error(`missing, failed or stale evidence: ${label}`)
        if (sha256(await readFile(join(checkRunDir(options.stateDir, contract.ticketId, r.runId), 'output.log'))) !== r.outputHash) throw new Error('output hash mismatch')
        used.push(r)
        return r
      }
      for (const check of verification.checks.filter(c => c.required)) {
        await bound(records.filter(r => r.checkId === check.id && !r.acceptanceId).at(-1), check.id)
      }
      for (const item of contract.task?.acceptance ?? []) {
        const r = await bound(records.filter(r => r.acceptanceId === item.id).at(-1), `acceptance ${item.id}`)
        if (r.baseExitCode === 0 || r.baseExitCode === undefined || !r.baseInnerCallId) throw new Error(`acceptance ${item.id} was not shown to fail on the base commit`)
      }
      const sessionId = execution.agent?.session.header.id
      if (options.sessionEvents && sessionId !== undefined) {
        const calls = nativeBashCalls(await options.sessionEvents(String(sessionId)))
        const missing = used.flatMap(r => [r.innerCallId, ...(r.baseInnerCallId ? [r.baseInnerCallId] : [])]).filter(id => !calls.has(id))
        if (missing.length) throw new Error(`evidence is not bound to native executions in this Worker Session: ${missing.join(', ')}`)
      } else if (options.requireSessionBinding) {
        throw new Error('Session event log is unavailable; evidence cannot be bound to native executions')
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
}
