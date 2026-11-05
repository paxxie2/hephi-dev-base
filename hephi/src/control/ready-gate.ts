import type { PreToolDecision, ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { ActivationContract } from './activation.js'

export type ReadyVerification = {
  ok: true
} | {
  ok: false
  reason: string
}

export type ReadyVerifier = (contract: ActivationContract, execution: ToolExecution) => Promise<ReadyVerification>

export type ReadyGate = {
  preExecute: (execution: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
  guard: (execution: ToolExecution) => string | undefined
  dispose: () => void
}

function isReadyReport(execution: ToolExecution): boolean {
  if (execution.name !== 'orchestrator_report' || !execution.arguments || typeof execution.arguments !== 'object') return false
  return (execution.arguments as { state?: unknown }).state === 'ready'
}

export function createReadyGate(options: {
  loadActivation: () => Promise<ActivationContract>
  verify?: ReadyVerifier
}): ReadyGate {
  const approved = new Set<ToolExecutionToken>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const approve = (token: ToolExecutionToken): void => {
    approved.add(token)
    const timer = setTimeout(() => {
      approved.delete(token)
      timers.delete(timer)
    }, 30_000)
    timers.add(timer)
  }

  const preExecute = async (execution: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    if (!isReadyReport(execution)) return next()
    let contract: ActivationContract
    try {
      contract = await options.loadActivation()
    } catch (error) {
      return { kind: 'deny', reason: `HEPHI activation is unavailable: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (!options.verify) return { kind: 'deny', reason: 'HEPHI verifier is not configured' }
    try {
      const result = await options.verify(contract, execution)
      if (!result.ok) return { kind: 'deny', reason: result.reason }
      approve(execution.token)
      return next()
    } catch (error) {
      return { kind: 'deny', reason: `HEPHI verification failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const guard = (execution: ToolExecution): string | undefined => {
    if (!isReadyReport(execution)) return undefined
    if (approved.delete(execution.token)) return undefined
    return 'HEPHI ready gate denied the call'
  }

  return {
    preExecute,
    guard,
    dispose: () => {
      approved.clear()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}
