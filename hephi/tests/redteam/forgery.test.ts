/**
 * A6 红队：伪造记录 / 输出篡改（本地模拟级）。
 *
 * 可声称边界（全文统一）：这些用例只证明「下列已列举的攻击在本地合成 Session 快照下被拒绝」，
 * 以及「对应合法请求可以完成」。它们**不**证明真实宿主上的证据链已核实（H1–H5/A2 未取得），
 * 也不证明“证据不可伪造”。合成快照本身是 fixture，不是真实 Worker Session。
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import { sha256 } from '../../src/verification/fingerprint.js'
import { saveRun } from '../../src/control/check-store.js'
import {
  boundSnapshot, callEvent, fakeJobs, fixture, foregroundValue, lastDecision, ready,
  rewriteRecord, resultEvent, runAll, snapshotOf, verifier, writeOutputLog, type Fixture,
} from './fixtures.js'

async function checked(): Promise<{ f: Fixture; records: Awaited<ReturnType<typeof runAll>> }> {
  const f = await fixture()
  const records = await runAll(f)
  return { f, records }
}

describe('伪造记录（本地合成快照）', () => {
  it('RT-FORGE-01: a hand-written record has no matching native call and is refused', async () => {
    const { f, records } = await checked()
    const real = records.find(record => record.checkId === 'build')!
    // 攻击者（可写状态目录）手写一条记录：字段齐全、指纹从真实记录复制，但 Session 中不存在这次执行。
    const forged = {
      ...real, runId: 'forged-run', sequence: real.sequence + 100, checkId: 'build',
      innerCallId: 'forged-inner-call', outputHash: sha256('forged output\n'),
    }
    await saveRun(f.stateDir, forged)
    await writeOutputLog(f, forged, 'forged output\n')
    const unit = records.find(record => record.checkId === 'unit')!
    const snapshot = snapshotOf([
      callEvent(unit, f.c, 0), resultEvent(unit, 1, foregroundValue()),
    ])
    const result = await verifier(f, { binding: true, readSession: async () => snapshot })(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：绑定开启时，手写记录在 Session 快照里找不到对应原生调用 → 拒绝。
    // 不声称：真实宿主的 Session 快照不可被 Worker 影响（H6 未验证）。
    if (!result.ok) expect(result.reason).toContain('no native evidence')
  })

  it('RT-FORGE-02: harmless command plus hand-written record is refused by the frozen-command comparison', async () => {
    const { f, records } = await checked()
    const real = records.find(record => record.checkId === 'build')!
    // 攻击者先跑一条无害命令，再手写记录让它看起来满足合同冻结命令（argv/cwd 都正确）。
    const forged = { ...real, runId: 'harmless-run', sequence: real.sequence + 100, innerCallId: 'harmless-call' }
    await saveRun(f.stateDir, forged)
    await writeOutputLog(f, forged, 'ok\n\n')
    const unit = records.find(record => record.checkId === 'unit')!
    const snapshot = snapshotOf([
      callEvent(forged, f.c, 0, { command: 'true' }), // 无害命令，不是合同冻结的 checkCommand(...,'-unit')
      resultEvent(forged, 1, foregroundValue()),
      callEvent(unit, f.c, 2), resultEvent(unit, 3, foregroundValue()),
    ])
    const result = await verifier(f, { binding: true, readSession: async () => snapshot })(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：Session 实际命令与合同重算命令不一致 → 拒绝（K1 的本地形态）。
    if (!result.ok) expect(result.reason).toContain('different command or directory')
  })

  it('RT-FORGE-03: a snapshot from another Session cannot back this Worker report', async () => {
    const { f, records } = await checked()
    const snapshot = boundSnapshot('other-session', records, f.c)
    const result = await verifier(f, { binding: true, readSession: async () => snapshot })(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：快照头部 Session id 与 ready 的 Worker Session 不一致 → 拒绝。
    if (!result.ok) expect(result.reason).toContain('different Session')

    // 另一形态：ready 报另一个 Session，而记录属于本 Session（无条件 K4）。
    const crossed = await verifier(f)(f.c, ready(f.r.dir, 'other-session'))
    expect(crossed.ok).toBe(false)
    if (!crossed.ok) expect(crossed.reason).toContain('check record belongs to Session')
  })

  it('RT-FORGE-04: replaying another ticket\'s run is refused (cross-ticket binding)', async () => {
    const { f, records } = await checked()
    const otherTicket = 'ticket-2'
    for (const record of records) {
      // 攻击者把旧工单证据复制到另一个工单并改写 ticketId/runId。
      const copied = { ...record, ticketId: otherTicket, runId: `${record.runId}-replayed` }
      await saveRun(f.stateDir, copied)
      await writeFile(join(f.stateDir, 'hephi', otherTicket, 'checks', copied.runId, 'output.log'), 'ok\n\n')
    }
    const otherContract = { ...f.c, ticketId: otherTicket, contractHash: `sha256:${'b'.repeat(64)}` }
    const result = await verifier(f)(otherContract, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：记录 contractHash 与当前合同不一致（跨工单/跨合同重放）→ 拒绝。
    if (!result.ok) expect(result.reason).toContain('missing, failed or stale evidence')
  })
})

describe('输出篡改（本地合成快照）', () => {
  it('RT-OUT-01: editing only output.log is refused', async () => {
    const { f, records } = await checked()
    const build = records.find(record => record.checkId === 'build')!
    await writeOutputLog(f, build, 'tampered log\n')
    const result = await verifier(f)(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：output.log 哈希与记录 outputHash 不一致 → 拒绝（绑定开关无关）。
    if (!result.ok) expect(result.reason).toContain('output hash mismatch')
  })

  it('RT-OUT-02: editing output.log and outputHash together is NOT detectable without authoritative output (known limit)', async () => {
    const { f, records } = await checked()
    const build = records.find(record => record.checkId === 'build')!
    await writeOutputLog(f, build, 'tampered output\n')
    await rewriteRecord(f, build, { outputHash: sha256('tampered output\n') })
    const result = await verifier(f)(f.c, ready(f.r.dir))
    // 可声称（边界）：绑定关闭且没有权威输出时，输出只与记录自身哈希一致，
    // 两者同时改写无法被发现——这是 README「已知限制」#2，不是“已修复”。
    // 不得据此声称证据不可伪造。
    expect(result).toEqual({ ok: true })
  })

  it('RT-OUT-03: with authoritative output (binding on) the same double edit is refused', async () => {
    const { f, records } = await checked()
    const build = records.find(record => record.checkId === 'build')!
    await writeOutputLog(f, build, 'tampered output\n')
    await rewriteRecord(f, build, { outputHash: sha256('tampered output\n') })
    const snapshot = boundSnapshot('worker-session', records, f.c)
    const result = await verifier(f, { binding: true, readSession: async () => snapshot })(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：绑定开启时用 Session 结构化 stdout/stderr 重算权威输出哈希，与记录不一致 → 拒绝。
    if (!result.ok) expect(result.reason).toContain('authoritative check output differs')
    expect((await lastDecision(f.stateDir, f.c.ticketId)).rule).toBe('ready.output-unverified')
  })

  it('RT-OUT-04: truncated authoritative output is refused (no silent downgrade)', async () => {
    const { f, records } = await checked()
    const events = records.flatMap((record, index) => [
      callEvent(record, f.c, index * 2),
      resultEvent(record, index * 2 + 1, foregroundValue({ stdout: { text: 'ok\n', truncated: true } })),
    ])
    const result = await verifier(f, { binding: true, readSession: async () => snapshotOf(events) })(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：权威输出被截断时 ready 拒绝，不按文本猜测。
    if (!result.ok) expect(result.reason).toContain('authoritative check output is unavailable')
    expect((await lastDecision(f.stateDir, f.c.ticketId)).rule).toBe('ready.output-unverified')
  })
})

describe('合法对照（同一夹具下的正常请求）', () => {
  it('RT-FORGE-LEGAL-01: a genuine foreground execution passes with binding on', async () => {
    const { f, records } = await checked()
    const snapshot = boundSnapshot('worker-session', records, f.c)
    expect(await verifier(f, { binding: true, readSession: async () => snapshot })(f.c, ready(f.r.dir))).toEqual({ ok: true })
    // 可声称：与上面攻击相同的手段下，真实（fixture 合成的）原生调用 + 权威输出可以通过。
  })

  it('RT-FORGE-LEGAL-02: the same evidence passes with binding off', async () => {
    const { f } = await checked()
    expect(await verifier(f)(f.c, ready(f.r.dir))).toEqual({ ok: true })
  })

  it('RT-FORGE-LEGAL-03: a completed background Job with matching output passes', async () => {
    const f = await fixture()
    const records = await runAll(f)
    const build = records.find(record => record.checkId === 'build')!
    const jobOutput = 'job output\n'
    await writeOutputLog(f, build, jobOutput)
    await rewriteRecord(f, build, { jobId: 'job-1', outputHash: sha256(jobOutput) })
    const singleCheck: ActivationContract = { ...f.c, verification: { version: 1, checks: [f.c.verification.checks[0]!] } }
    const jobs = fakeJobs({
      views: { 'job-1': { status: 'completed', detail: 'exit code: 0' } },
      reads: { 'job-1': { chunks: [{ at: 0, text: jobOutput }], lossy: false } },
    })
    const snapshot = snapshotOf([
      callEvent(build, singleCheck, 0),
      resultEvent(build, 1, { kind: 'background', jobId: 'job-1' }),
    ])
    const result = await verifier(f, { binding: true, readSession: async () => snapshot, jobs })(singleCheck, ready(f.r.dir))
    expect(result).toEqual({ ok: true })
    // 可声称：后台 Job 终态 completed + exit code 0 + 完整输出时可以通过。
  })
})
