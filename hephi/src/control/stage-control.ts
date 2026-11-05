import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { executionModeOf, type ActivationContract } from './activation.js'
import { allowedPath } from './repository.js'
import { inScope } from './discipline.js'
import { groupAlive, runStageCheck } from './stage-process.js'

const exec = promisify(execFile)
const checkSchema = z.object({
  id: z.string().regex(/^[\w-]+$/), command: z.string().min(1), args: z.array(z.string()),
  timeoutMs: z.number().int().min(1).max(3600000).default(600000),
}).strict()
const definition = z.object({ id: z.string().regex(/^[\w-]+$/), objective: z.string().min(1), scope: z.array(z.string().min(1)).min(1), checks: z.array(checkSchema).min(1).refine(c => new Set(c.map(x => x.id)).size === c.length, 'Duplicate check IDs') }).strict()
export const stagePlanSchema = z.array(definition).min(2).refine(s => new Set(s.map(x => x.id)).size === s.length, 'Duplicate stage IDs')
type Definition = z.infer<typeof definition>
type Attempt = {
  id: string; baseHead: string; startedAt: string; pid?: number; launchPending?: boolean;
  before?: string; checks: Array<{ id: string; log: string; result: string; exitCode: number | null; startedAt: string; finishedAt: string }>;
  checkpointId?: string; head?: string; fingerprint?: string; progressCallId?: string;
  commitTree?: string; commitFingerprint?: string; error?: string
}
type Stage = Definition & { status: 'pending' | 'in_progress' | 'checking' | 'completed'; attempts: Attempt[] }
type RecordData = { version: 1; ticketId: string; contractHash: string; stages: Stage[]; history: Array<{ at: string; action: string; stageId?: string; reason?: string }> }
// Read-only investigation plus explicit observation/stop of an existing child. Staged never auto-terminates it.
export const READ_ONLY_TOOLS = new Set(['job_kill', 'read', 'glob', 'grep', 'read_image', 'skill', 'hephi_get_contract', 'hephi_kb_search', 'orchestrator_read', 'job_list', 'job_output', 'list_agents', 'wait_agent', 'interrupt_agent'])
const READ = READ_ONLY_TOOLS
export const MODIFYING_TOOLS = new Set(['write', 'edit', 'bash', 'pwsh'])
/** Actual host delegation/continuation entries: worker subagents plus Agent Team tools. */
export const DELEGATION_TOOLS = new Set(['subagent', 'subagent_fork', 'workflow', 'spawn_teammate', 'send_message', 'team_task_create', 'team_task_update'])
const IMPLEMENT = MODIFYING_TOOLS
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'killed'])
/** running/stopping block; terminal settles; any unknown value fails closed. */
export function jobStatusBlocking(status: string): boolean {
  if (status === 'running' || status === 'stopping') return true
  if (TERMINAL_JOB_STATUSES.has(status)) return false
  throw new Error(`Unknown Job state "${String(status)}"; stage remains closed`)
}
export type StageJobs = { list(sessionId: string): Array<{ status: string }> }
export type StageRuntime = {
  sessionId?: string
  jobs?: () => StageJobs | undefined
  activeChildren?: () => Promise<string[]>
}
export class StageControl {
  private data?: RecordData
  private fault?: string
  private persisted?: string
  private tail: Promise<unknown> = Promise.resolve()
  private active = new Set<unknown>()
  private pendingPlan = false
  private readyChecking = false
  private violation?: string
  constructor(readonly path: string, readonly contract: ActivationContract, readonly workspace: string, private readonly runtime: StageRuntime = {}) {
    if (executionModeOf(contract) !== 'staged') {
      this.fault = 'HEPHI stage control requires an explicitly staged activation contract'
      return
    }
    try {
      const persisted = readFileSync(path, 'utf8')
      const d = JSON.parse(persisted) as RecordData
      if (d.version !== 1 || d.ticketId !== contract.ticketId || d.contractHash !== contract.contractHash) throw new Error('Stage record contract mismatch')
      if (!Array.isArray(d.history)) throw new Error('Invalid stage history')
      stagePlanSchema.parse(d.stages.map(({ id, objective, scope, checks }) => ({ id, objective, scope, checks })))
      for (const s of d.stages) {
        if (!['pending', 'in_progress', 'checking', 'completed'].includes(s.status) || !Array.isArray(s.attempts)) throw new Error('Invalid stage state')
        if (s.status !== 'pending' && !s.attempts.length) throw new Error('Missing stage attempt')
        for (const a of s.attempts) {
          if (typeof a.id !== 'string' || typeof a.baseHead !== 'string' || !Array.isArray(a.checks)) throw new Error('Invalid attempt')
          if (a.pid !== undefined && (!Number.isSafeInteger(a.pid) || a.pid <= 0)) throw new Error('Invalid check process identity')
          if (a.checkpointId || a.commitTree) {
            if (a.checks.length !== s.checks.length || a.checks.some((c, i) => c.id !== s.checks[i].id || c.result !== 'passed')) throw new Error('Incomplete checkpoint check evidence')
            if (a.pid || a.launchPending) throw new Error('Checkpoint has an unsettled check process')
          }
          if (a.checkpointId && (!a.head || !a.fingerprint)) throw new Error('Incomplete checkpoint identity')
          if (a.progressCallId && !a.checkpointId) throw new Error('Progress has no checkpoint')
        }
        if (s.status === 'completed') {
          const a = s.attempts.at(-1)!
          if (!a.checkpointId || !a.head || !a.fingerprint || !a.progressCallId || a.checks.length !== s.checks.length || a.checks.some((c, i) => c.id !== s.checks[i].id || c.result !== 'passed')) throw new Error('Incomplete completed-stage evidence')
        }
      }
      if (d.stages.filter(s => ['in_progress', 'checking'].includes(s.status)).length > 1) throw new Error('Multiple active stages')
      // A valid ledger is a completed prefix, optionally one active stage, then pending stages.
      let unfinished = false
      let pending = false
      for (const s of d.stages) {
        if (s.status === 'completed' && unfinished) throw new Error('Completed stage follows an unfinished stage')
        if (['in_progress', 'checking'].includes(s.status) && pending) throw new Error('Active stage follows a pending stage')
        if (s.status !== 'completed') unfinished = true
        if (s.status === 'pending') pending = true
      }
      this.data = d
      this.persisted = persisted
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.fault = String(error)
    }
  }
  private save(action?: string, stageId?: string, reason?: string) {
    if (!this.data) return
    const tmp = `${this.path}.${randomUUID()}.tmp`
    try {
      if (action) this.data.history.push({ at: new Date().toISOString(), action, stageId, reason })
      mkdirSync(dirname(this.path), { recursive: true })
      const persisted = JSON.stringify(this.data, null, 2)
      writeFileSync(tmp, persisted, { mode: 0o600 }); renameSync(tmp, this.path)
      this.persisted = persisted
    }
    catch (e) { this.fault = `Cannot persist stage record: ${String(e)}`; throw e }
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn)
    this.tail = result.catch(() => {})
    return result
  }
  private assert() {
    if (this.fault) throw new Error(this.fault)
    if (this.data) {
      try {
        const persisted = readFileSync(this.path, 'utf8')
        if (persisted !== this.persisted) throw new Error('Stage record changed outside this controller')
        const disk = JSON.parse(persisted)
        if (disk.ticketId !== this.contract.ticketId || disk.contractHash !== this.contract.contractHash) throw new Error('Stage record contract mismatch')
      } catch (e) { this.fault = `Stage record missing or invalid: ${String(e)}`; throw new Error(this.fault) }
    }
  }
  private async git(...args: string[]) { return (await exec('git', args, { cwd: this.workspace, maxBuffer: 20 * 1024 * 1024 })).stdout.trim() }
  private async clean() { if (await this.git('status', '--porcelain', '--untracked-files=all')) throw new Error('Worktree must be clean') }
  private async fingerprint() {
    const h = createHash('sha256')
    h.update(await this.git('rev-parse', 'HEAD'))
    h.update(await this.git('write-tree')) // Bind staged content as well as working files.
    // Include tracked, staged and untracked content; ignored build outputs are intentionally excluded.
    const raw = (await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: this.workspace, maxBuffer: 20 * 1024 * 1024 })).stdout
    for (const f of [...new Set(raw.split('\0').filter(Boolean))].sort()) {
      h.update(f + '\0')
      try {
        const stat = await lstat(join(this.workspace, f)); h.update(String(stat.mode))
        if (stat.isSymbolicLink()) throw new Error('Stage snapshots do not support symlinks')
        h.update(await readFile(join(this.workspace, f)))
      } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') h.update('deleted'); else throw e }
    }
    return h.digest('hex')
  }
  /** Admission and execution wrappers both call this; guards alone do not track running calls. */
  denial(name: string, args: any): string | undefined {
    // blocked/progress reports must reach the host even when control is unavailable;
    // progress() never advances a faulted, violated or otherwise closed controller.
    if (name === 'orchestrator_report' && args?.state !== 'ready') return
    if (name === 'hephi_stage') return this.fault
    if (name === 'hephi_check') {
      if (this.fault || this.violation) return this.fault ?? this.violation
      if (this.readyChecking) return 'HEPHI final ready verification is still running'
      if (this.pendingPlan) return 'HEPHI stage transition is closing modification admission'
      if (!this.data || !this.data.stages.every(s => s.status === 'completed')) return 'HEPHI check requires every stage to be completed and its checkpoint progress reported'
      return
    }
    if (READ.has(name)) return
    if (this.fault) return this.fault
    // Staged execution forbids every implementation delegation from mount through final report.
    if (DELEGATION_TOOLS.has(name)) return 'HEPHI staged execution forbids implementation delegation through subagents or an Agent Team'
    if (this.violation) return this.violation
    if (name === 'orchestrator_report') {
      // Progress (including the pre-plan staging reason) is allowed; ready needs a completed plan.
      // The ready report itself must survive the ready lock that its own pre-execute set.
      if (args?.state === 'ready' && (!this.data || !this.data.stages.every(s => s.status === 'completed'))) return 'HEPHI stages are incomplete; plan and finish every stage before ready'
      return
    }
    if (!this.data) return 'HEPHI staged execution requires a plan before implementation'
    if (this.readyChecking) return 'HEPHI final ready verification is still running'
    if (this.pendingPlan) return 'HEPHI stage transition is closing modification admission'
    if (this.data.stages.every(s => s.status === 'completed')) return // Original delivery flow; ready rechecks final fingerprint.
    if (args?.run_in_background === true) return 'HEPHI staged implementation must run in foreground'
    if (!this.data.stages.some(s => s.status === 'in_progress')) return 'HEPHI modification is closed: finish checks and progress, then start the next stage'
  }
  track(token: unknown) { this.active.add(token) }
  enter(token: unknown, name: string, args: unknown) {
    this.assert()
    const reason = this.denial(name, args); if (reason) throw new Error(reason)
    if (IMPLEMENT.has(name)) this.track(token)
  }
  leave(token: unknown) { this.active.delete(token) }
  /** Jobs whose state is not terminal keep the stage closed; unknown values fail closed. */
  private jobsBlocking(): boolean {
    const registry = this.runtime.jobs?.()
    if (!registry) throw new Error('Native Job registry is required for staged execution')
    let blocking = false
    for (const job of registry.list(this.runtime.sessionId ?? '')) {
      if (jobStatusBlocking(job.status)) blocking = true
    }
    return blocking
  }
  private async activeChildren(): Promise<string[]> {
    return await (this.runtime.activeChildren?.() ?? Promise.resolve([]))
  }
  /** Recovery records active children so even a mutation-only turn stays closed. */
  recordActiveChildren(children: string[]) {
    this.violation = children.length
      ? `HEPHI staged execution has active implementation subagent(s): ${children.join(', ')}; wait for them to finish or interrupt them explicitly, then retry`
      : undefined
  }
  private async refreshActiveChildren(): Promise<void> {
    try {
      this.recordActiveChildren(await this.activeChildren())
    } catch (error) {
      this.violation = `HEPHI staged execution cannot confirm subagent activity: ${error instanceof Error ? error.message : String(error)}`
      throw new Error(this.violation)
    }
    if (this.violation) throw new Error(this.violation)
  }
  private async refuseActiveChildren(): Promise<void> {
    await this.refreshActiveChildren()
  }
  private async drain(signal?: AbortSignal) {
    signal?.throwIfAborted()
    await this.refreshActiveChildren()
    const end = Date.now() + 30000
    while (this.active.size || this.jobsBlocking()) {
      signal?.throwIfAborted()
      if (Date.now() > end) throw new Error('Modification tools are still running; stage remains closed')
      await new Promise(r => setTimeout(r, 25))
    }
  }
  async update(action: string, stageId?: string, plan?: unknown, reason?: string, signal?: AbortSignal) {
    return this.serial(async () => {
      this.assert()
      if (this.readyChecking) throw new Error('Wait for the current ready report to settle')
      await this.refuseActiveChildren()
      if (action === 'plan') {
        const defs = stagePlanSchema.parse(plan)
        if (!reason?.trim()) throw new Error('Plan requires a concrete reason')
        if (this.data) {
          await this.drain(signal)
          if (defs.length !== this.data.stages.length) throw new Error('Do not remove or add stages in an existing plan')
          for (let i = 0; i < defs.length; i++) {
            const old = this.data.stages[i]
            if (old.id !== defs[i].id) throw new Error('Stage identities/order are immutable')
            if (old.attempts.length && JSON.stringify(defs[i]) !== JSON.stringify({ id: old.id, objective: old.objective, scope: old.scope, checks: old.checks })) throw new Error('Started stage definitions are immutable')
          }
          this.data.stages = defs.map((d, i) => ({ ...this.data!.stages[i], ...d }))
        } else {
          this.pendingPlan = true
          try {
            await this.drain(signal); await this.clean()
            this.data = { version: 1, ticketId: this.contract.ticketId, contractHash: this.contract.contractHash, stages: defs.map(d => ({ ...d, status: 'pending', attempts: [] })), history: [] }
          } finally { this.pendingPlan = false }
        }
        this.save('plan', undefined, reason)
        return { planned: true }
      }
      if (!this.data) throw new Error('Register staged plan first')
      await this.recoverProgress()
      const index = this.data.stages.findIndex(s => s.id === stageId)
      if (index < 0) throw new Error('Unknown stage')
      const stage = this.data.stages[index]
      if (action === 'start') {
        if (stage.status === 'in_progress') return { stageId, status: stage.status }
        const reopeningReceipt = stage.status === 'checking' && Boolean(stage.attempts.at(-1)?.checkpointId) && Boolean(reason?.trim())
        if (this.data.stages.some(s => (s.status === 'in_progress' || s.status === 'checking') && !(s === stage && reopeningReceipt))) throw new Error('Another stage is active or awaiting successful checkpoint progress; retry finish/report, or start the checkpointed stage with reason to reopen')
        if (this.data.stages.slice(0, index).some(s => s.status !== 'completed')) throw new Error('Previous stages are incomplete')
        if (stage.status === 'completed' && !reason?.trim()) throw new Error('Reopening requires reason')
        this.pendingPlan = true
        try {
          await this.drain(signal)
          // A reopened stage preserves late, uncommitted delivery changes.
          if (stage.status !== 'completed' && !reopeningReceipt) {
            await this.clean()
            if (index > 0) await this.checkpointFresh(this.data.stages[index - 1].attempts.at(-1)!)
          }
          for (const later of this.data.stages.slice(index + 1)) later.status = 'pending'
          const baseHead = await this.git('rev-parse', 'HEAD')
          stage.status = 'in_progress'
          stage.attempts.push({ id: randomUUID(), baseHead, startedAt: new Date().toISOString(), checks: [] })
          this.save('start', stage.id, reason)
          return { stageId, status: stage.status }
        } finally { this.pendingPlan = false }
      }
      if (action !== 'finish') throw new Error('Unknown action')
      if (stage.status === 'completed') return this.receipt(stage)
      if (stage.status !== 'in_progress' && stage.status !== 'checking') throw new Error('Start this stage first')
      let attempt = stage.attempts.at(-1)!
      if (attempt.launchPending) throw new Error('Check launch was interrupted before process identity was recorded; termination must be confirmed externally')
      if (attempt.pid && groupAlive(attempt.pid)) throw new Error('Previous check process may still be alive; modification remains closed')
      delete attempt.pid
      if (attempt.checkpointId) { await this.checkpointFresh(attempt); return this.receipt(stage) }
      // Recover a commit created before the checkpoint receipt was saved.
      if (attempt.commitTree) {
        if (await this.git('rev-parse', 'HEAD') === attempt.baseHead) {
          if (await this.git('write-tree') !== attempt.commitTree || await this.fingerprint() !== attempt.commitFingerprint) throw new Error('Interrupted checkpoint index/source changed')
          await this.git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', `HEPHI stage ${stage.id}: ${stage.objective}`)
        }
        await this.clean()
        if (await this.git('rev-parse', 'HEAD^{tree}') !== attempt.commitTree) throw new Error('Interrupted checkpoint cannot be reconciled; inspect index and commit outcome')
        const parent = await this.git('rev-parse', 'HEAD^')
        if (parent !== attempt.baseHead) throw new Error('Interrupted checkpoint parent mismatch')
        await this.completeCheckpoint(stage); return this.receipt(stage)
      }
      if (attempt.before || attempt.checks.length || attempt.error) {
        const old = attempt
        attempt = { id: randomUUID(), baseHead: old.baseHead, startedAt: new Date().toISOString(), checks: [] }
        stage.attempts.push(attempt)
      }
      stage.status = 'checking'; this.save('checking', stage.id)
      await this.drain(signal)
      try {
        if (await this.git('rev-parse', 'HEAD') !== attempt.baseHead) throw new Error('Do not commit manually inside a stage; reopen/reconcile the unexpected HEAD')
        const diff = await this.git('diff', '--name-only', '-z', attempt.baseHead)
        const staged = await this.git('diff', '--cached', '--name-only', '-z')
        const untracked = await this.git('ls-files', '-z', '--others', '--exclude-standard')
        const files = [...new Set((diff + '\0' + staged + '\0' + untracked).split('\0').filter(Boolean))]
        if (files.some(f => /[\r\n]/.test(f))) throw new Error('Stage paths containing line breaks are unsupported')
        if (files.some(f => !inScope(this.contract, f) || !allowedPath(f, stage.scope))) throw new Error('Stage changes exceed stage or contract paths')
        attempt.before = await this.fingerprint(); this.save()
        for (const check of stage.checks) {
          const dir = join(dirname(this.path), 'stage-evidence', attempt.id, check.id)
          await mkdir(dir, { recursive: true })
          const log = join(dir, 'output.log')
          const startedAt = new Date().toISOString()
          attempt.launchPending = true; this.save()
          const result = await runStageCheck({ ...check, cwd: this.workspace, log, signal,
            env: { ...process.env, HEPHI_BASE_COMMIT: this.contract.baseSha },
            onPid: pid => { attempt.pid = pid; attempt.launchPending = false; this.save() },
            onStopped: () => { delete attempt.pid; attempt.launchPending = false; this.save() },
          })
          if (!result.ended) throw new Error('Check process termination is unconfirmed; stage remains closed')
          delete attempt.pid
          const passed = !result.interrupted && result.exitCode === 0
          attempt.checks.push({ id: check.id, log, exitCode: result.exitCode, result: passed ? 'passed' : 'failed', startedAt, finishedAt: new Date().toISOString() }); this.save()
          if (!passed) throw new Error(`Check ${check.id} did not meet its declared expectation: exit=${result.exitCode}, interrupted=${result.interrupted}`)
        }
        if (attempt.before !== await this.fingerprint()) throw new Error('Source changed during checks; evidence invalid')
        if (files.length) {
          await this.git('add', '--', ...files)
          attempt.commitTree = await this.git('write-tree'); attempt.commitFingerprint = await this.fingerprint(); this.save()
          await this.git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', `HEPHI stage ${stage.id}: ${stage.objective}`)
        }
        await this.completeCheckpoint(stage)
        return this.receipt(stage)
      } catch (error) {
        attempt.error = String(error)
        if (!attempt.pid && !attempt.launchPending && !attempt.commitTree) stage.status = 'in_progress'
        this.save('finish-failed', stage.id)
        throw error
      }
    })
  }
  private async completeCheckpoint(stage: Stage) {
    await this.clean()
    const a = stage.attempts.at(-1)!
    a.checkpointId = randomUUID(); a.head = await this.git('rev-parse', 'HEAD'); a.fingerprint = await this.fingerprint()
    this.save('checkpoint', stage.id)
  }
  private receipt(stage: Stage) {
    const a = stage.attempts.at(-1)!
    return { stageId: stage.id, checkpointId: a.checkpointId, head: a.head, checks: a.checks, progressMarker: `HEPHI_STAGE_CHECKPOINT=${a.checkpointId}` }
  }
  private async checkpointFresh(a: Attempt) {
    await this.clean()
    if (!a.fingerprint || a.head !== await this.git('rev-parse', 'HEAD') || a.fingerprint !== await this.fingerprint()) throw new Error('Checkpoint changed; reopen stage and revalidate')
  }
  /** Called only for frozen successful orchestrator_report results, never model text. */
  progress(summary: string, callId: string): Promise<void> {
    return this.serial(async () => {
      this.assert()
      // A report may pass the host gate during an error, but it must not advance
      // a stage whose child activity is active or no longer confirmable.
      try { await this.refreshActiveChildren() } catch { return }
      if (this.violation) return
      const stage = this.data?.stages.find(s => s.status === 'checking')
      const a = stage?.attempts.at(-1)
      if (!a?.checkpointId || !summary.split(/\r?\n/).some(l => l.trim() === `HEPHI_STAGE_CHECKPOINT=${a.checkpointId}`)) return
      try { await this.checkpointFresh(a) } catch (error) {
        a.error = `Progress cannot complete changed checkpoint: ${String(error)}`
        this.save('progress-invalid', stage!.id)
        return
      }
      a.progressCallId = callId; this.save('progress-received', stage!.id)
      stage!.status = 'completed'; this.save('completed', stage!.id)
    })
  }
  waitingForProgress(): boolean { return Boolean(this.data?.stages.some(s => s.status === 'checking' && s.attempts.at(-1)?.checkpointId && !s.attempts.at(-1)?.progressCallId)) }
  private async recoverProgress() {
    for (const stage of this.data?.stages ?? []) {
      const a = stage.attempts.at(-1)
      if (stage.status === 'checking' && a?.progressCallId) {
        try { await this.checkpointFresh(a) } catch (error) {
          a.error = `Recovered progress refers to changed source: ${String(error)}`
          this.save('recover-progress-invalid', stage.id)
          continue
        }
        stage.status = 'completed'; this.save('recover-progress', stage.id)
      }
    }
  }
  private async validateReady() {
    this.assert()
    if (!this.data) throw new Error('HEPHI staged plan is required before ready; ordinary tasks use native mode')
    await this.refuseActiveChildren()
    await this.recoverProgress()
    if (!this.data.stages.every(s => s.status === 'completed')) throw new Error('HEPHI stages are incomplete; finish and report each checkpoint')
    await this.checkpointFresh(this.data.stages.at(-1)!.attempts.at(-1)!)
  }
  ready(): Promise<void> { return this.serial(() => this.validateReady()) }
  beginReady(signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      this.assert()
      if (!this.data) throw new Error('HEPHI staged plan is required before ready; ordinary tasks use native mode')
      if (this.readyChecking) throw new Error('A ready report is already being verified')
      this.readyChecking = true
      try { await this.drain(signal); await this.validateReady() }
      catch (error) { this.readyChecking = false; throw error }
    })
  }
  endReady() { this.readyChecking = false }
}
