import { defineTool, type ToolExecution, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { dirname, join } from 'node:path'
import { activationPath } from './activation.js'
import { executionModeOf, type ActivationContract } from './activation.js'
import { resolveWorkspace } from './workspace.js'
import type { ReadyVerification } from './ready-gate.js'
import { DELEGATION_TOOLS, MODIFYING_TOOLS, READ_ONLY_TOOLS, StageControl, jobStatusBlocking, type StageJobs } from './stage-control.js'

/** Public rc.5 events; keep this adapter structural while the project retains older dev types. */
type Outcome = { isError: boolean; value?: unknown }
type ScopedTools = {
  on(name: 'tools/execute', listener: (e: ToolExecution, next: () => Promise<Outcome>) => Promise<Outcome>): () => void
  on(name: 'tools/result', listener: (e: ToolExecution, r: Outcome) => undefined): () => void
  tools: { register(tool: unknown): () => void; guard(fn: (e: ToolExecution) => string | undefined): () => void }
}
// Structural host prompt service; stage guidance is registered only for staged mode.
type PromptContext = Context & {
  systemPrompt: { section(section: { name: string; order: number; interpolate: boolean; text: () => string }): () => void }
}
export type StageSessionQuery = { readSession(id: string): Promise<{ session: { id: string }; inheritedEventCount: number; events: Array<{ seq: number; type: string; data: any }> }> }
/** DSH's public subagent seam, used only to detect already-active children during recovery. */
export type StageSubagents = { listChildren(parentSessionId: string): Promise<Array<{ id: string; label?: string }>> }
/** DSH's public Agent.status: idle means no driver remains scheduled or active. */
export type StageAgent = { status?: 'idle' | 'running' }
export type StageAgents = { get(id: string): StageAgent | undefined }
export type { StageJobs } from './stage-control.js'

const STAGE_PROMPT = 'HEPHI execution mode: staged. Call hephi_stage(action="plan", ...) before any implementation or ready report. From mount through the final report, do not create implementation subagents or an Agent Team; only read-only investigation is allowed outside the current stage. Keep every check in the foreground, finish the active stage, report its exact HEPHI_STAGE_CHECKPOINT marker through orchestrator_report(progress), and start the next stage only after that progress succeeds. Native Worker push/PR and the cumulative ready verification remain unchanged.'

export type StageControlOptions = {
  loadContract: () => Promise<ActivationContract>
  jobs: () => StageJobs | undefined
  sessionQuery: () => StageSessionQuery | undefined
  subagents: () => StageSubagents | undefined
  agents: () => StageAgents | undefined
}

function modeSensitive(name: string): boolean {
  return name === 'hephi_stage' || name === 'hephi_check' || name === 'orchestrator_report' || MODIFYING_TOOLS.has(name) || DELEGATION_TOOLS.has(name)
}

function nonReadyReport(name: string, args: unknown): boolean {
  return name === 'orchestrator_report' && (args as { state?: unknown } | null)?.state !== 'ready'
}

/**
 * A catalogued child is active while its loaded public Agent.status is running,
 * or while it owns a running/unknown Job even if its Agent is already unloaded.
 * A missing/idle Agent with settled jobs is not a blocker. Unknown lifecycle/job
 * values fail closed.
 */
async function activeStagedChildren(subagents: StageSubagents, agents: StageAgents, jobs: StageJobs, sessionId: string): Promise<string[]> {
  const active: string[] = []
  for (const child of await subagents.listChildren(sessionId)) {
    const id = String(child.id)
    const live = agents.get(id)
    // An unloaded Agent does not prove its native Jobs ended. Check every
    // catalogued child; an idle or missing Agent with active jobs still blocks.
    let liveActive = false
    if (live !== undefined) {
      if (live.status === 'running') liveActive = true
      else if (live.status !== 'idle') throw new Error(`Unknown subagent lifecycle status "${String(live.status)}"; stage remains closed`)
    }
    let jobActive = false
    for (const job of jobs.list(id)) {
      if (jobStatusBlocking(job.status)) jobActive = true
    }
    if (liveActive || jobActive) active.push(id)
  }
  return active
}

export function installStageControl(agent: Agent, stateDir: string, ticketId: string, options: StageControlOptions) {
  const ctx = agent.ctx as unknown as ScopedTools
  const path = join(dirname(activationPath(stateDir, ticketId)), 'execution-plan.json')
  let controller: StageControl | undefined
  let loading: Promise<StageControl> | undefined
  let failure: string | undefined
  let readyToken: unknown
  const inFlight = new Map<unknown, { name: string; args: unknown }>()
  const load = () => loading ??= (async () => {
    const contract = await options.loadContract()
    if (executionModeOf(contract) !== 'staged') throw new Error('HEPHI stage control requires an explicitly staged activation contract')
    const workspace = await resolveWorkspace(contract.workspace, agent.session.header.cwd)
    const jobs = options.jobs()
    if (!jobs) throw new Error('Native Job registry is required for staged execution')
    const subagents = options.subagents()
    if (!subagents) throw new Error('Native subagent registry is required to audit staged recovery')
    const agents = options.agents()
    if (!agents) throw new Error('Native Agent registry is required to audit staged recovery')
    const sessionId = String(agent.id ?? agent.session.header.id)
    controller = new StageControl(path, contract, workspace, {
      sessionId,
      jobs: options.jobs,
      activeChildren: () => activeStagedChildren(subagents, agents, jobs, sessionId),
    })
    for (const token of inFlight.keys()) controller.track(token)
    // Detect an already-active child before progress recovery or any stage transition can advance.
    controller.recordActiveChildren(await activeStagedChildren(subagents, agents, jobs, sessionId))
    if (controller.waitingForProgress()) {
      const query = options.sessionQuery()
      if (!query) throw new Error('Session query is required to reconcile an unrecorded progress after remount')
      await recoverStageProgress(controller, await query.readSession(String(agent.session.header.id)), String(agent.session.header.id))
    }
    return controller
  })().catch(e => { failure = `HEPHI stages unavailable: ${String(e)}`; throw e })

  const stageTool = defineTool({
    name: 'hephi_stage',
    description: 'Only for deliberately staged HEPHI tasks. plan registers at least two stages; start opens one stage (reason required to reopen); finish runs real foreground checks and creates a local checkpoint. Then report the exact returned progressMarker via orchestrator_report(progress). Ordinary tasks do not call this tool. Checks must return zero only when the project acceptance checks succeed. Do not manually commit within a stage. Creating implementation subagents or an Agent Team is forbidden for the whole staged cycle.',
    parameters: {
      action: { type: 'string', required: true }, stageId: { type: 'string' }, reason: { type: 'string' },
      planJson: { type: 'string', description: 'JSON array: [{id,objective,scope:[glob],checks:[{id,command,args:[],timeoutMs:600000}]}].' },
    },
    output: { schema: { type: 'json' as const }, render: (_a: unknown, v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] },
    async execute(args, e: ToolRunContext) {
      const c = await load()
      return JSON.parse(JSON.stringify(await c.update(args.action, args.stageId, args.planJson ? JSON.parse(args.planJson) : undefined, args.reason, e.signal)))
    },
  })
  const disposers = [ctx.tools.register(stageTool)]
  disposers.push((agent.ctx as unknown as PromptContext).systemPrompt.section({
    name: 'hephi:staged-execution',
    order: 901,
    interpolate: false,
    text: () => STAGE_PROMPT,
  }))
  disposers.push(ctx.tools.guard(e => {
    // blocked/progress must be reportable even when stage control cannot load.
    if (nonReadyReport(e.name, e.arguments)) return undefined
    let reason = (READ_ONLY_TOOLS.has(e.name) ? undefined : failure) ?? controller?.denial(e.name, e.arguments)
    // Before the first load there is no ledger yet: delegation stays forbidden
    // and mutation stays closed until hephi_stage plan creates the plan.
    if (!reason && !controller && DELEGATION_TOOLS.has(e.name)) reason = 'HEPHI staged execution forbids implementation delegation through subagents or an Agent Team'
    if (!reason && !controller && e.name === 'hephi_check') reason = 'HEPHI check requires every stage to be completed and its checkpoint progress reported'
    if (!reason && !controller && MODIFYING_TOOLS.has(e.name)) reason = 'HEPHI staged execution requires a hephi_stage plan before implementation'
    if (!reason && MODIFYING_TOOLS.has(e.name)) {
      // Admission can precede dispatch. Keep it tracked through the frozen result,
      // including cancellation or a later guard denying the admitted call.
      inFlight.set(e.token, { name: e.name, args: e.arguments })
      controller?.track(e.token)
    }
    return reason
  }))
  disposers.push(ctx.on('tools/execute', async (e, next) => {
    const modifying = MODIFYING_TOOLS.has(e.name)
    if (modifying) inFlight.set(e.token, { name: e.name, args: e.arguments })
    if (!modeSensitive(e.name)) return await next()
    if (nonReadyReport(e.name, e.arguments)) {
      // The host must receive blocked/progress reports even after a stage-control
      // load failure; a failed load never advances the stage.
      if (!failure) {
        try { await load() } catch { /* failure is latched; the report still proceeds */ }
      }
      return await next()
    }
    if (failure) throw new Error(failure)
    const c = await load()
    const current = await options.loadContract()
    if (current.contractHash !== c.contract.contractHash) throw new Error('Stage contract changed; cannot reuse prior state')
    if (executionModeOf(current) !== 'staged') throw new Error('HEPHI execution mode changed; cannot reuse staged control')
    c.enter(e.token, e.name, e.arguments)
    return await next()
  }))
  disposers.push(ctx.on('tools/result', (e, r) => {
    inFlight.delete(e.token); controller?.leave(e.token)
    if (e.token === readyToken) { controller?.endReady(); readyToken = undefined }
    if (e.name !== 'orchestrator_report' || r.isError || !controller || failure) return undefined
    const args = e.arguments as { state?: string; summary?: string }
    const value = r.value as { reported?: boolean } | undefined
    if (args.state === 'progress' && typeof args.summary === 'string' && value?.reported === true) {
      const c = controller
      // Re-read the bound contract before completing a stage; a report is still
      // allowed to reach the host, but a changed contract cannot advance it.
      void (async () => {
        const current = await options.loadContract()
        if (current.contractHash !== c.contract.contractHash) throw new Error('Stage contract changed before progress completion')
        if (executionModeOf(current) !== 'staged') throw new Error('HEPHI execution mode changed before progress completion')
        await c.progress(args.summary!, String(e.callId))
      })().catch(error => { failure = `HEPHI progress persistence failed: ${String(error)}` })
    }
    return undefined
  }))
  return {
    verify: async (run: () => Promise<ReadyVerification>, signal: AbortSignal, token: unknown) => {
      if (failure) throw new Error(failure)
      const c = await load()
      await c.beginReady(signal)
      readyToken = token
      try {
        const result = await run()
        if (result.ok) await c.ready()
        else { c.endReady(); readyToken = undefined }
        // Success stays closed until the original report's final tool result.
        return result
      } catch (error) { c.endReady(); readyToken = undefined; throw error }
    },
    dispose: () => { controller?.endReady(); for (const dispose of disposers.reverse()) dispose() },
  }
}

/** Reconcile actual successful, owned tool events, not assistant summaries or inherited history. */
export async function recoverStageProgress(controller: StageControl, snapshot: Awaited<ReturnType<StageSessionQuery['readSession']>>, sessionId: string) {
  if (snapshot.session.id !== sessionId) throw new Error('Recovery Session mismatch')
  const calls = new Map<string, string>()
  for (const event of snapshot.events) {
    if (event.seq < snapshot.inheritedEventCount) continue
    const data = event.data
    if (event.type === 'tool/call' && data.name === 'orchestrator_report') {
      let args
      try { args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments } catch { continue }
      if (args?.state === 'progress' && typeof args.summary === 'string') calls.set(data.callId, args.summary)
    } else if (event.type === 'tool/result') {
      const message = data.message
      const summary = calls.get(message?.toolCallId)
      if (!summary || message.isError !== false) continue
      const texts = (message.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text)
      for (const text of texts) {
        let value
        try { value = JSON.parse(text) } catch { continue }
        if (value?.reported === true) {
          await controller.progress(summary, message.toolCallId)
          break
        }
      }
    }
  }
}
