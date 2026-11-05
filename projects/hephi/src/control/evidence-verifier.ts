import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verificationOf } from './activation.js'
import type { ReadyVerifier } from './ready-gate.js'
import { gitFingerprint, sha256 } from '../verification/fingerprint.js'
import { allowedPath, clean, defaultPullRequest, hasCommit, normalizeRepository, remoteRepository, type PullRequestInfo } from './repository.js'
import { resolveWorkspace } from './workspace.js'
import { requireKnowledgeQuery } from '../kb/index.js'
import { checkRunDir, readRuns } from './check-store.js'
import { sameSource } from './check-runner.js'

export function createEvidenceVerifier(options: { stateDir: string; pullRequest?: (repo: string, n: number) => Promise<PullRequestInfo> }): ReadyVerifier {
  return async (contract, execution) => {
    try {
      const verification = verificationOf(contract)
      await requireKnowledgeQuery(contract, options.stateDir)
      const workspace = await resolveWorkspace(contract.workspace, execution.agent?.session.header.cwd)
      if (normalizeRepository(await remoteRepository(workspace)) !== normalizeRepository(contract.repository)
        || !await hasCommit(workspace, contract.baseSha) || !await clean(workspace)) throw new Error('repository/base/clean check failed')
      const before = await gitFingerprint(workspace, contract.baseSha)
      if (!before.changedFiles.length || before.changedFiles.some(p => !allowedPath(p, contract.allowedPaths))) throw new Error('missing patch or path outside contract')
      const records = await readRuns(options.stateDir, contract.ticketId)
      if (records.some(r => r.status === 'unknown' || r.status === 'running')) throw new Error('unfinished/unsupported check execution; operator resolution required')
      for (const check of verification.checks.filter(c => c.required)) {
        const r = records.filter(r => r.checkId === check.id).at(-1)
        if (!r || r.status !== 'passed' || r.exitCode !== 0 || r.contractHash !== contract.contractHash
          || !r.sessionId || !r.callId || !r.innerCallId || !r.finishedAt
          || !sameSource(r.before, before) || !sameSource(r.after, before)) throw new Error(`missing, failed or stale evidence: ${check.id}`)
        const dir = checkRunDir(options.stateDir, contract.ticketId, r.runId)
        if (sha256(await readFile(join(dir, 'output.log'))) !== r.outputHash) throw new Error('output hash mismatch')

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
