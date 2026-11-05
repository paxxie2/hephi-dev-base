import { parseVerificationConfig } from '../../src/contracts/checks.js'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createReadyGate } from '../../src/control/ready-gate.js'
import type { ActivationContract } from '../../src/control/activation.js'

const contract: ActivationContract = {
  enabled: true,
    verification: parseVerificationConfig({ version: 1, checks: [{ id: 'fixture', kind: 'build', purpose: 'fixture only', command: 'true', args: [] }] }),
  ticketId: 'ticket-1',
  repository: 'paxxie2/dubbo',
  issueNumber: 42,
  workspace: '/tmp/ticket-1',
  baseRef: 'main',
  baseSha: 'a'.repeat(40),
  allowedPaths: ['dubbo-common/**'],
  requirePullRequest: false,
  contractHash: 'sha256:test',
}

function execution(name: string, args: unknown): ToolExecution {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
    token: Symbol('execution') as ToolExecutionToken,
  }
}

const next = async () => ({ kind: 'allow' as const })

describe('HEPHI ready gate', () => {
  it('does not affect non-ready calls', async () => {
    const gate = createReadyGate({ loadActivation: async () => contract })
    await expect(gate.preExecute(execution('bash', {}), next)).resolves.toEqual({ kind: 'allow' })
    expect(gate.guard(execution('bash', {}))).toBeUndefined()
    gate.dispose()
  })

  it('denies ready until the verifier is connected', async () => {
    const gate = createReadyGate({ loadActivation: async () => contract })
    await expect(gate.preExecute(execution('orchestrator_report', { state: 'ready' }), next)).resolves.toMatchObject({ kind: 'deny' })
    gate.dispose()
  })

  it('allows only a ready call that passed verification', async () => {
    const gate = createReadyGate({
      loadActivation: async () => contract,
      verify: async () => ({ ok: true as const }),
    })
    const ready = execution('orchestrator_report', { state: 'ready' })
    await expect(gate.preExecute(ready, next)).resolves.toEqual({ kind: 'allow' })
    expect(gate.guard(ready)).toBeUndefined()
    expect(gate.guard(ready)).toBe('HEPHI ready gate denied the call')
    gate.dispose()
  })

  it('returns the verifier reason when verification fails', async () => {
    const gate = createReadyGate({
      loadActivation: async () => contract,
      verify: async () => ({ ok: false as const, reason: 'scope exceeded' }),
    })
    await expect(gate.preExecute(execution('orchestrator_report', { state: 'ready' }), next)).resolves.toEqual({ kind: 'deny', reason: 'scope exceeded' })
    gate.dispose()
  })
})
