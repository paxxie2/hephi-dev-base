import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it, expect } from 'vitest'
import { StageControl } from '../../src/control/stage-control.js'
import type { ActivationContract } from '../../src/control/activation.js'
const exec = promisify(execFile)
function control(path: string, contract: ActivationContract, repo: string, jobs: () => Array<{ status: string }> = () => []) {
  return new StageControl(path, contract, repo, {
    sessionId: 't',
    jobs: () => ({ list: () => jobs() }),
    activeChildren: async () => [],
  })
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'hephi-stage-'))
  const repo = join(root, 'repo'); await exec('git', ['init', repo])
  const git = async (...args: string[]) => (await exec('git', args, { cwd: repo })).stdout.trim()
  await git('config', 'user.email', 'test@example.invalid'); await git('config', 'user.name', 'Stage test')
  await writeFile(join(repo, 'a.txt'), 'base'); await git('add', '.'); await git('commit', '-m', 'base')
  const contract = { ticketId: 't', contractHash: 'hash', allowedPaths: ['**'], baseSha: await git('rev-parse', 'HEAD'), executionMode: 'staged' } as ActivationContract
  const path = join(root, 'state', 'execution-plan.json')
  const c = control(path, contract, repo)
  const plan = ['A', 'B'].map(id => ({ id, objective: id, scope: ['**'], checks: [{ id: 'node', command: process.execPath, args: ['-e', 'console.log("actual check")'] }] }))
  return { root, repo, git, path, contract, c, plan }
}
async function report(c: StageControl, id: string) {
  const receipt = await c.update('finish', id) as { progressMarker: string }
  await c.progress(receipt.progressMarker, `call-${id}`)
  return receipt
}
describe('Stage control — local integration with actual Git and processes, not Issue E2E', () => {
  it('runs a real Node test without a report adapter', async () => {
    const { c, plan, repo, root } = await setup()
    try {
      const checks: any[] = plan[0].checks
      checks[0] = { id: 'tests', command: process.execPath, args: ['--test', 'case.test.mjs'] }
      await c.update('plan', undefined, plan, 'native test execution')
      await c.update('start', 'A')
      await writeFile(join(repo, 'case.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('actual HTTP-independent assertion', () => assert.equal(2 + 2, 4));\n")
      await report(c, 'A')
      const d = JSON.parse(await readFile(join(root, 'state', 'execution-plan.json'), 'utf8'))
      const attempt = d.stages[0].attempts[0]
      const output = await readFile(attempt.checks[0].log, 'utf8')
      expect(output).toContain('actual HTTP-independent assertion')
      expect(attempt.checks[0].exitCode).toBe(0)
      expect(d.stages[0].status).toBe('completed')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('ordinary task is untouched; stages enforce checks, progress and final delivery freshness', async () => {
    const { c, plan, repo, git } = await setup()
    expect(c.denial('bash', {})).toContain('plan')
    expect(c.denial('subagent', {})).toContain('subagent')
    expect(c.denial('read', {})).toBeUndefined()
    expect(c.denial('orchestrator_report', { state: 'progress' })).toBeUndefined()
    expect(c.denial('orchestrator_report', { state: 'ready' })).toContain('incomplete')
    await expect(c.ready()).rejects.toThrow('plan')
    await c.update('plan', undefined, plan, 'two independently checked changes')
    expect(c.denial('bash', {})).toContain('closed')
    await c.update('start', 'A')
    await expect(c.update('start', 'B')).rejects.toThrow('active')
    await writeFile(join(repo, 'a.txt'), 'A change')
    const checkpoint = await c.update('finish', 'A') as { progressMarker: string }
    expect(c.denial('bash', {})).toContain('closed')
    await expect(c.update('start', 'B')).rejects.toThrow('progress')
    await c.progress('A done', 'wrong'); await expect(c.update('start', 'B')).rejects.toThrow()
    await c.progress(checkpoint.progressMarker, 'actual-progress')
    await c.update('start', 'B'); const head = await git('rev-parse', 'HEAD')
    await report(c, 'B'); expect(await git('rev-parse', 'HEAD')).toBe(head)
    expect(c.denial('bash', {})).toBeUndefined()
    expect(c.denial('spawn_teammate', {})).toContain('Agent Team')
    await c.ready()
    await writeFile(join(repo, 'a.txt'), 'late delivery change')
    await expect(c.ready()).rejects.toThrow('clean')
    await git('add', '.'); await git('commit', '-m', 'late change')
    await expect(c.ready()).rejects.toThrow('Checkpoint changed')
  })
  it('allows hephi_check only after every stage is completed and reported', async () => {
    const { c, plan } = await setup()
    expect(c.denial('hephi_check', { checkId: 'unit' })).toContain('stage')
    await c.update('plan', undefined, plan, 'reason')
    await c.update('start', 'A')
    expect(c.denial('hephi_check', { checkId: 'unit' })).toContain('every stage')
    await report(c, 'A')
    expect(c.denial('hephi_check', { checkId: 'unit' })).toContain('every stage')
    await c.update('start', 'B')
    await report(c, 'B')
    expect(c.denial('hephi_check', { checkId: 'unit' })).toBeUndefined()
  })

  it('checking blocks mutation while actual slow process is running and drains accepted writes', async () => {
    const { c, plan } = await setup()
    plan[0].checks[0].args = ['-e', 'setTimeout(()=>{},150)']
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    c.enter('running-edit', 'edit', {})
    const finish = c.update('finish', 'A')
    await new Promise(r => setTimeout(r, 30))
    expect(c.denial('write', {})).toContain('closed'); expect(c.denial('bash', {})).toContain('closed')
    expect(c.denial('read', {})).toBeUndefined()
    c.leave('running-edit'); await finish
  })
  it('failed checks reopen A; failed log remains after retry', async () => {
    const { c, plan, repo, path } = await setup()
    plan[0].checks[0].args = ['-e', 'process.exit(require("fs").existsSync("fixed")?0:1)']
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await expect(c.update('finish', 'A')).rejects.toThrow('did not meet')
    expect(c.denial('write', {})).toBeUndefined()
    await writeFile(join(repo, 'fixed'), 'yes'); await report(c, 'A')
    const d = JSON.parse(await readFile(path, 'utf8'))
    expect(d.stages[0].attempts).toHaveLength(2)
    expect(d.stages[0].attempts[0].checks[0].exitCode).toBe(1)
    expect(await readFile(d.stages[0].attempts[0].checks[0].log, 'utf8')).toBe('')
  })
  it('reopens completed A and invalidates B without deleting earlier evidence', async () => {
    const { c, plan, path } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A'); await report(c, 'A')
    await c.update('start', 'B'); await report(c, 'B')
    await expect(c.update('start', 'A')).rejects.toThrow('reason')
    await c.update('start', 'A', undefined, 'final verification requires fix')
    await expect(c.ready()).rejects.toThrow('incomplete')
    const d = JSON.parse(await readFile(path, 'utf8'))
    expect(d.stages[0].attempts).toHaveLength(2); expect(d.stages[1].status).toBe('pending')
    expect(d.stages[1].attempts[0].progressCallId).toBe('call-B')
  })
  it('resumes receipt without duplicate commit and recovers received progress', async () => {
    const { c, plan, path, contract, repo, git } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await writeFile(join(repo, 'a.txt'), 'changed'); const receipt = await c.update('finish', 'A')
    const head = await git('rev-parse', 'HEAD')
    const restored = control(path, contract, repo)
    expect(await restored.update('finish', 'A')).toEqual(receipt)
    expect(await git('rev-parse', 'HEAD')).toBe(head)
    const d = JSON.parse(await readFile(path, 'utf8')); d.stages[0].attempts[0].progressCallId = 'recorded-success'
    await writeFile(path, JSON.stringify(d))
    await control(path, contract, repo).update('start', 'B')
  })
  it('denies corrupt records and contract changes', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason')
    await expect(control(path, { ...contract, contractHash: 'changed' }, repo).ready()).rejects.toThrow('mismatch')
    await writeFile(path, '{')
    expect(control(path, contract, repo).denial('bash', {})).toBeTruthy()
  })
  it('rejects out-of-scope changes and checks that alter source', async () => {
    const { c, plan, repo } = await setup()
    plan[0].checks[0].args = ['-e', 'require("fs").writeFileSync("a.txt","changed by check")']
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await expect(c.update('finish', 'A')).rejects.toThrow('Source changed')
    expect(c.denial('write', {})).toBeUndefined()
  })
})

describe('Failure and recovery boundaries — local integration', () => {
  it('timeout terminates the check and allows A to be repaired, not B', async () => {
    const { c, plan } = await setup()
    const checks = plan[0].checks as Array<any>
    checks[0] = { ...checks[0], args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 50 }
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await expect(c.update('finish', 'A')).rejects.toThrow('did not meet')
    expect(c.denial('edit', {})).toBeUndefined()
    await expect(c.update('start', 'B')).rejects.toThrow('active')
  })
  it('missing executable is a check failure, never a reproduction', async () => {
    const { c, plan } = await setup()
    plan[0].checks[0].command = '/no-such-hephi-executable'
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await expect(c.update('finish', 'A')).rejects.toThrow('did not meet')
    expect(c.denial('edit', {})).toBeUndefined()
  })
  it('rejects removed parser/reproduction options instead of silently accepting them', async () => {
    const { c, plan, root } = await setup()
    try {
      Object.assign(plan[0].checks[0], { parser: 'maven', expect: 'reproduce' })
      await expect(c.update('plan', undefined, plan, 'reason')).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('fails closed when record is deleted after activation', async () => {
    const { c, plan, path } = await setup()
    await c.update('plan', undefined, plan, 'reason')
    const { unlink } = await import('node:fs/promises'); await unlink(path)
    await expect(c.update('start', 'A')).rejects.toThrow('missing')
    expect(c.denial('bash', {})).toContain('missing')
  })
  it('reopens while preserving dirty changes made during delivery', async () => {
    const { c, plan, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A'); await report(c, 'A')
    await c.update('start', 'B'); await report(c, 'B')
    await writeFile(join(repo, 'a.txt'), 'late work')
    await c.update('start', 'A', undefined, 'preserve late changes and revalidate')
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('late work')
    await report(c, 'A'); await c.update('start', 'B'); await report(c, 'B'); await c.ready()
  })
  it('does not repeat a commit after a lost receipt', async () => {
    const { c, plan, path, repo, git, contract } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await writeFile(join(repo, 'a.txt'), 'new'); await c.update('finish', 'A')
    const d = JSON.parse(await readFile(path, 'utf8')); const a = d.stages[0].attempts[0]
    delete a.checkpointId; delete a.head; delete a.fingerprint
    await writeFile(path, JSON.stringify(d))
    const count = await git('rev-list', '--count', 'HEAD')
    await control(path, contract, repo).update('finish', 'A')
    expect(await git('rev-list', '--count', 'HEAD')).toBe(count)
  })
})

describe('Concurrent operations and native job drain — focused tests', () => {
  it('serializes repeated finish without duplicate commits or checkpoints', async () => {
    const { c, plan, repo, git } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await writeFile(join(repo, 'a.txt'), 'one change')
    const [a, b] = await Promise.all([c.update('finish', 'A'), c.update('finish', 'A')])
    expect(a).toEqual(b); expect(await git('rev-list', '--count', 'HEAD')).toBe('2')
  })
  it('drains promoted native jobs before executing checks', async () => {
    const { plan, path, contract, repo } = await setup()
    let running = false
    const c = control(path, contract, repo, () => running ? [{ status: 'running' }] : [])
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    running = true
    const promise = c.update('finish', 'A')
    await new Promise(r => setTimeout(r, 40))
    const d = JSON.parse(await readFile(path, 'utf8'))
    expect(d.stages[0].status).toBe('checking'); expect(d.stages[0].attempts[0].checks).toHaveLength(0)
    expect(c.denial('bash', {})).toContain('closed')
    running = false; await promise
  })
  it('a checkpoint changed before progress stays incomplete and can be reopened explicitly', async () => {
    const { c, plan, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const receipt = await c.update('finish', 'A') as { progressMarker: string }
    await writeFile(join(repo, 'a.txt'), 'external change')
    await c.progress(receipt.progressMarker, 'success-but-stale')
    await expect(c.update('start', 'B')).rejects.toThrow('active')
    await c.update('start', 'A', undefined, 'revalidate external change')
    await report(c, 'A'); await c.update('start', 'B')
  })
})

describe('Self-review regressions', () => {
  it('a source check that changes only the Git index invalidates evidence', async () => {
    const { c, plan } = await setup()
    plan[0].checks[0].args = ['-e', 'const fs=require("fs"),{execFileSync:g}=require("child_process");fs.writeFileSync("a.txt","unverified staged value");g("git",["add","a.txt"]);fs.writeFileSync("a.txt","base")']
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await expect(c.update('finish', 'A')).rejects.toThrow('Source changed')
  })
  it('cannot commit a stale staged version hidden behind unchanged working content', async () => {
    const { c, plan, repo, git } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    await writeFile(join(repo, 'a.txt'), 'stale staged content'); await git('add', 'a.txt')
    await writeFile(join(repo, 'a.txt'), 'base'); await writeFile(join(repo, 'b.txt'), 'B')
    await c.update('finish', 'A')
    expect(await git('show', 'HEAD:a.txt')).toBe('base')
    expect(await git('status', '--porcelain')).toBe('')
  })
  it('unknown process identity after an interrupted launch keeps writes closed', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const d = JSON.parse(await readFile(path, 'utf8'))
    d.stages[0].status = 'checking'; d.stages[0].attempts[0].launchPending = true
    await writeFile(path, JSON.stringify(d))
    const restored = control(path, contract, repo)
    await expect(restored.update('finish', 'A')).rejects.toThrow('process identity')
    expect(restored.denial('write', {})).toContain('closed')
  })
  it('changed source after a received progress can be reopened after restart', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A'); await c.update('finish', 'A')
    const d = JSON.parse(await readFile(path, 'utf8')); d.stages[0].attempts[0].progressCallId = 'already-received'
    await writeFile(path, JSON.stringify(d)); await writeFile(join(repo, 'a.txt'), 'external')
    const restored = control(path, contract, repo)
    await expect(restored.ready()).rejects.toThrow('incomplete')
    await restored.update('start', 'A', undefined, 'revalidate after external change')
    await report(restored, 'A')
  })
  it('final ready closes writes and stage updates until the report settles', async () => {
    const { c, plan } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A'); await report(c, 'A')
    await c.update('start', 'B'); await report(c, 'B')
    await c.beginReady()
    expect(c.denial('bash', {})).toContain('ready verification')
    expect(c.denial('subagent', {})).toContain('subagent')
    expect(c.denial('orchestrator_report', { state: 'ready' })).toBeUndefined()
    await expect(c.update('start', 'A', undefined, 'change')).rejects.toThrow('ready report')
    await expect(c.beginReady()).rejects.toThrow('already')
    expect(c.denial('write', {})).toContain('ready verification')
    c.endReady(); expect(c.denial('bash', {})).toBeUndefined()
  })
})

describe('Progress replay — explicit Session event fixtures, not production restart acceptance', () => {
  it('recovers a successful progress whose ledger update was lost', async () => {
    const { recoverStageProgress } = await import('../../src/control/stage-mount.js')
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const receipt = await c.update('finish', 'A') as { progressMarker: string }
    const restored = control(path, contract, repo)
    const call = { seq: 10, type: 'tool/call', data: { name: 'orchestrator_report', callId: 'persisted-call', arguments: JSON.stringify({ state: 'progress', summary: receipt.progressMarker }) } }
    const result = { seq: 11, type: 'tool/result', data: { message: { toolCallId: 'persisted-call', isError: false, content: [{ type: 'text', text: '{"reported":true}' }] } } }
    await recoverStageProgress(restored, { session: { id: 'worker-t' }, inheritedEventCount: 0, events: [call, result] }, 'worker-t')
    await restored.update('start', 'B')
    expect(JSON.parse(await readFile(path, 'utf8')).stages[0].attempts[0].progressCallId).toBe('persisted-call')
  })
  it('does not accept failed, inherited or unacknowledged report events', async () => {
    const { recoverStageProgress } = await import('../../src/control/stage-mount.js')
    const { c, plan } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const receipt = await c.update('finish', 'A') as { progressMarker: string }
    const call = { seq: 10, type: 'tool/call', data: { name: 'orchestrator_report', callId: 'call', arguments: JSON.stringify({ state: 'progress', summary: receipt.progressMarker }) } }
    for (const [inherited, isError, reported] of [[12, false, true], [0, true, true], [0, false, false]] as const) {
      const result = { seq: 11, type: 'tool/result', data: { message: { toolCallId: 'call', isError, content: [{ type: 'text', text: JSON.stringify({ reported }) }] } } }
      await recoverStageProgress(c, { session: { id: 'worker-t' }, inheritedEventCount: inherited, events: [call, result] }, 'worker-t')
      await expect(c.update('start', 'B')).rejects.toThrow('active')
    }
  })
})

// Corrupted persisted-state fixtures: recovery checks only, not real Worker E2E.
describe('Stage ledger recovery invariants', () => {
  it('rejects completed or active stages after unfinished predecessors', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason')
    await c.update('start', 'A'); await report(c, 'A')
    await c.update('start', 'B'); await report(c, 'B')
    const d = JSON.parse(await readFile(path, 'utf8'))
    d.stages[0].status = 'pending'
    await writeFile(path, JSON.stringify(d))
    await expect(control(path, contract, repo).ready()).rejects.toThrow('Completed stage follows')
    d.stages[1].status = 'in_progress'
    await writeFile(path, JSON.stringify(d))
    const restored = control(path, contract, repo)
    expect(restored.denial('write', {})).toContain('Active stage follows')
    await expect(restored.update('start', 'B')).rejects.toThrow('Active stage follows')
  })
  it('rejects completed evidence for a different declared check', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason')
    await c.update('start', 'A'); await report(c, 'A')
    const d = JSON.parse(await readFile(path, 'utf8'))
    d.stages[0].attempts.at(-1).checks[0].id = 'unrelated-check'
    await writeFile(path, JSON.stringify(d))
    await expect(control(path, contract, repo).ready()).rejects.toThrow('Incomplete checkpoint check evidence')
  })
})

describe('Self-check loop: persistence failure regressions (local fixtures)', () => {
  it('does not complete a recovered checkpoint with missing check evidence', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const receipt = await c.update('finish', 'A') as { progressMarker: string }
    const d = JSON.parse(await readFile(path, 'utf8')); d.stages[0].attempts[0].checks = []
    await writeFile(path, JSON.stringify(d))
    const restored = control(path, contract, repo)
    await expect(restored.progress(receipt.progressMarker, 'successful-report')).rejects.toThrow()
    expect(restored.denial('write', {})).toBeTruthy()
  })
  it('blocks tool entry if the loaded stage record is replaced or removed', async () => {
    for (const remove of [false, true]) {
      const { c, plan, path } = await setup()
      await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
      if (remove) await rm(path)
      else { const d = JSON.parse(await readFile(path, 'utf8')); d.stages[0].status = 'pending'; await writeFile(path, JSON.stringify(d)) }
      expect(() => c.enter('write', 'write', {})).toThrow()
    }
  })
  it('latches persistence failure when the record directory disappears during a write', async () => {
    const { c, plan, path, root } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    // Trigger the save-directory failure after assert() has read the valid ledger.
    const original = (c as any).save.bind(c)
    ;(c as any).save = (...args: unknown[]) => {
      renameSync(join(root, 'state'), join(root, 'saved-state'))
      writeFileSync(join(root, 'state'), 'not a directory')
      return original(...args)
    }
    await expect(c.update('finish', 'A')).rejects.toThrow()
    expect(c.denial('hephi_stage', {})).toContain('Cannot persist')
  })
})

describe('Self-check loop: stage handoff freshness (actual Git)', () => {
  it('refuses B when A checkpoint was replaced by a clean intervening commit', async () => {
    const { c, plan, repo, git } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A'); await report(c, 'A')
    await writeFile(join(repo, 'a.txt'), 'unverified intervening change')
    await git('add', 'a.txt'); await git('commit', '-m', 'outside stage control')
    expect(await git('status', '--porcelain')).toBe('')
    await expect(c.update('start', 'B')).rejects.toThrow('Checkpoint changed')
    expect(c.denial('write', {})).toContain('closed')
    await c.update('start', 'A', undefined, 'revalidate intervening change')
    await report(c, 'A'); await c.update('start', 'B'); await report(c, 'B'); await c.ready()
  })
})

describe('Self-check loop: malformed recovery metadata (fixtures)', () => {
  it('fails closed before tool entry if history metadata is invalid', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const d = JSON.parse(await readFile(path, 'utf8')); d.history = null
    await writeFile(path, JSON.stringify(d))
    const restored = control(path, contract, repo)
    expect(() => restored.enter('write', 'write', {})).toThrow()
  })
})

describe('Optional execution mode boundaries — staged failure closure', () => {
  it('keeps writes closed while an already-active child is recorded, then resumes after it ends', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    let active = ['child-1']
    const restored = new StageControl(path, contract, repo, {
      sessionId: 't',
      jobs: () => ({ list: () => [] }),
      activeChildren: async () => active,
    })
    restored.recordActiveChildren(active)
    expect(restored.denial('write', {})).toContain('active implementation subagent')
    expect(restored.denial('spawn_teammate', {})).toContain('Agent Team')
    expect(restored.denial('interrupt_agent', {})).toBeUndefined()
    await expect(restored.update('finish', 'A')).rejects.toThrow('active implementation subagent')
    expect(restored.denial('write', {})).toContain('active implementation subagent')
    active = []
    await report(restored, 'A')
    expect(restored.denial('write', {})).toContain('closed')
  })

  it('fails closed on an unknown native Job status instead of treating it as finished', async () => {
    const { c, plan, path, contract, repo } = await setup()
    await c.update('plan', undefined, plan, 'reason'); await c.update('start', 'A')
    const unknown = new StageControl(path, contract, repo, {
      sessionId: 't',
      jobs: () => ({ list: () => [{ status: 'mystery' }] }),
    })
    expect(unknown.denial('write', {})).toBeUndefined()
    await expect(unknown.update('finish', 'A')).rejects.toThrow('Unknown Job state')
    expect(unknown.denial('write', {})).toContain('closed')
    expect(unknown.denial('read', {})).toBeUndefined()
  })

  it('does not treat finished jobs as blockers and refuses delegation after all stages complete', async () => {
    const { c, plan } = await setup()
    const finished = control(c.path, c.contract, c.workspace, () => [{ status: 'completed' }, { status: 'failed' }, { status: 'killed' }])
    await finished.update('plan', undefined, plan, 'reason'); await finished.update('start', 'A'); await report(finished, 'A')
    await finished.update('start', 'B'); await report(finished, 'B')
    expect(finished.denial('write', {})).toBeUndefined()
    expect(finished.denial('subagent', {})).toContain('subagent')
    await finished.ready()
  })
})
