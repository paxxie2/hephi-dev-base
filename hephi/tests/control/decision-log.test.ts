import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendDecision, decisionLogPath } from '../../src/control/decision-log.js'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-decisions-'))
  cleanup.push(dir)
  return dir
}
const entry = (over: Record<string, unknown> = {}) => ({
  ticketId: 'ticket-1', sessionId: 'worker-session', callId: 'call-1', tool: 'write',
  mode: 'enforce' as const, effectiveDecision: 'allow' as const, wouldDecision: 'allow' as const,
  rule: 'scope.allowed', contractHash: 'sha256:test', ...over,
})
async function lines(dir: string): Promise<any[]> {
  const text = await readFile(decisionLogPath(dir, 'ticket-1'), 'utf8')
  return text.trim().split('\n').map(line => JSON.parse(line))
}

describe('decision log', () => {
  it('appends an ordered entry and never rewrites earlier lines', async () => {
    const dir = await stateDir()
    expect(await appendDecision(dir, entry())).toEqual({ ok: true, seq: 1 })
    const first = (await readFile(decisionLogPath(dir, 'ticket-1'), 'utf8'))
    expect(await appendDecision(dir, entry({ tool: 'edit', rule: 'scope.outside-task', effectiveDecision: 'deny', wouldDecision: 'deny', reason: 'outside' }))).toEqual({ ok: true, seq: 2 })
    const text = await readFile(decisionLogPath(dir, 'ticket-1'), 'utf8')
    expect(text.startsWith(first)).toBe(true)
    const parsed = await lines(dir)
    expect(parsed.map(item => item.seq)).toEqual([1, 2])
    expect(parsed[0]).toMatchObject({ version: 1, ticketId: 'ticket-1', tool: 'write', rule: 'scope.allowed', pluginCommit: expect.any(String) })
    expect(parsed[1]).toMatchObject({ tool: 'edit', rule: 'scope.outside-task', effectiveDecision: 'deny', wouldDecision: 'deny', reason: 'outside' })
  })

  it('serializes concurrent appends into unique ordered seq', async () => {
    const dir = await stateDir()
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => appendDecision(dir, entry({ callId: `call-${i}` }))))
    expect(results.every(result => result.ok)).toBe(true)
    const parsed = await lines(dir)
    expect(parsed).toHaveLength(25)
    expect(parsed.map(item => item.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    expect(new Set(parsed.map(item => item.callId)).size).toBe(25)
  })

  it('U-K5-06b: stores the effective binding policy as an additive v1 field', async () => {
    const dir = await stateDir()
    const binding = { contract: true, host: false, effective: true as const }
    expect(await appendDecision(dir, entry({ tool: 'orchestrator_report', binding }))).toEqual({ ok: true, seq: 1 })
    expect(await appendDecision(dir, entry({ tool: 'orchestrator_report', binding: { contract: null, host: true, effective: true } }))).toEqual({ ok: true, seq: 2 })
    const parsed = await lines(dir)
    expect(parsed[0]).toMatchObject({ version: 1, binding: { contract: true, host: false, effective: true } })
    expect(parsed[1]).toMatchObject({ version: 1, binding: { contract: null, host: true, effective: true } })
    // The field is optional: entries without a binding decision keep the old shape.
    expect(parsed[0]).not.toHaveProperty('binding.unknown')
    expect(Object.keys(parsed[1])).toContain('binding')
  })

  it('reports a write failure without throwing and does not invent a record', async () => {
    const dir = await stateDir()
    const logDir = join(dir, 'hephi', 'ticket-1')
    await mkdir(logDir, { recursive: true })
    await chmod(logDir, 0o500)
    try {
      const result = await appendDecision(dir, entry())
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.logError).toMatch(/EACCES|permission denied/i)
    } finally {
      await chmod(logDir, 0o700)
    }
    await expect(readFile(decisionLogPath(dir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
