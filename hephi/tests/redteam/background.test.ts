/**
 * A6 红队：后台检查 / Job 终态（本地模拟级）。
 *
 * 可声称边界：这些用例只证明「下列已列举的 Job 攻击在合成 Session 快照 + 假 Job 接口下被拒绝」，
 * 以及「completed + exit 0 + 完整输出的合法 Job 可以通过」。真实宿主 Job 接口语义（H3/H3a）未验证；
 * 不证明证据不可伪造。
 */
import { describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import type { CheckRunRecord } from '../../src/control/check-store.js'
import { sha256 } from '../../src/verification/fingerprint.js'
import {
  callEvent, fakeJobs, fixture, foregroundValue, lastDecision, ready, resultEvent, rewriteRecord,
  runAll, snapshotOf, verifier, writeOutputLog,
} from './fixtures.js'

const JOB_OUTPUT = 'job output\n'

type BackgroundFixture = {
  contract: ActivationContract
  record: CheckRunRecord
  stateDir: string
  workspace: string
  ticketId: string
  events: ReturnType<typeof callEvent>[]
  result: (value: unknown) => ReturnType<typeof resultEvent>
}

/** One check, stored as a background Job record whose output hash matches JOB_OUTPUT. */
async function backgroundFixture(): Promise<BackgroundFixture> {
  const f = await fixture()
  const records = await runAll(f)
  const build = records.find(record => record.checkId === 'build')!
  await writeOutputLog(f, build, JOB_OUTPUT)
  const record = await rewriteRecord(f, build, { jobId: 'job-1', exitCode: 0, outputHash: sha256(JOB_OUTPUT) })
  const contract: ActivationContract = { ...f.c, verification: { version: 1, checks: [f.c.verification.checks[0]!] } }
  return {
    contract, record, stateDir: f.stateDir, workspace: f.r.dir, ticketId: f.c.ticketId,
    events: [callEvent(record, contract, 0)],
    result: (value: unknown) => resultEvent(record, 1, value),
  }
}

const completedJobs = () => fakeJobs({
  views: { 'job-1': { status: 'completed', detail: 'exit code: 0' } },
  reads: { 'job-1': { chunks: [{ at: 0, text: JOB_OUTPUT }], lossy: false } },
})

describe('后台 Job 证据（本地合成快照 + 假 Job 接口）', () => {
  it('RT-JOB-01: a Session Job id that differs from the record is refused', async () => {
    const x = await backgroundFixture()
    const result = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, x.result({ kind: 'background', jobId: 'job-2' })]), jobs: completedJobs(),
    })(x.contract, ready(x.workspace))
    expect(result.ok).toBe(false)
    // 可声称：Session 结果里的 Job id 与记录不一致 → 拒绝。
    if (!result.ok) expect(result.reason).toContain('differs from the recorded Job')
  })

  it('RT-JOB-02: a Job not readable for this Session is refused as ready.job-unavailable', async () => {
    const x = await backgroundFixture()
    const result = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, x.result({ kind: 'background', jobId: 'job-1' })]),
      jobs: fakeJobs({ getThrows: true }),
    })(x.contract, ready(x.workspace))
    expect(result.ok).toBe(false)
    // 可声称：jobs.get 取不到（已清除或不属于本 Session）→ 拒绝，并记录 ready.job-unavailable。
    if (!result.ok) expect(result.reason).toContain('Job terminal state is unavailable')
    expect((await lastDecision(x.stateDir, x.ticketId)).rule).toBe('ready.job-unavailable')
  })

  it('RT-JOB-03: a failed Job is refused', async () => {
    const x = await backgroundFixture()
    const result = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, x.result({ kind: 'background', jobId: 'job-1' })]),
      jobs: fakeJobs({ views: { 'job-1': { status: 'failed', detail: 'exit code: 1' } } }),
    })(x.contract, ready(x.workspace))
    expect(result.ok).toBe(false)
    // 可声称：Job 终态不是 completed → 拒绝。
    if (!result.ok) expect(result.reason).toContain('terminal status is failed')
  })

  it('RT-JOB-04: a still-running Job is refused', async () => {
    const x = await backgroundFixture()
    const result = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, x.result({ kind: 'background', jobId: 'job-1' })]),
      jobs: fakeJobs({ views: { 'job-1': { status: 'running' } } }),
    })(x.contract, ready(x.workspace))
    expect(result.ok).toBe(false)
    // 可声称：Job 仍在运行 → 拒绝（不能把“启动成功”当成“检查成功”）。
    if (!result.ok) expect(result.reason).toContain('terminal status is running')
  })

  it('RT-JOB-05: a cleared Job output is refused as unverified output', async () => {
    const x = await backgroundFixture()
    const result = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, x.result({ kind: 'background', jobId: 'job-1' })]),
      jobs: completedJobs(), // readAt 存在，但下面换成只有 get 的接口模拟输出已清除
    })(x.contract, ready(x.workspace))
    expect(result.ok).toBe(true)
    // 上面是合法对照；下面的“输出已清除”必须拒绝。
    const cleared = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, x.result({ kind: 'background', jobId: 'job-1' })]),
      jobs: fakeJobs({ views: { 'job-1': { status: 'completed', detail: 'exit code: 0' } } }),
    })(x.contract, ready(x.workspace))
    expect(cleared.ok).toBe(false)
    // 可声称：Job 终态可读但输出读不到 → 拒绝为 output-unverified（不静默降级）。
    if (!cleared.ok) expect(cleared.reason).toContain('authoritative check output is unavailable')
    expect((await lastDecision(x.stateDir, x.ticketId)).rule).toBe('ready.output-unverified')
  })

  it('RT-JOB-06: a healthy foreground execution is refused when the record names a Job', async () => {
    const x = await backgroundFixture()
    const result = await verifier(x, {
      binding: true, readSession: async () => snapshotOf([x.events[0]!, resultEvent(x.record, 1, foregroundValue())]),
      jobs: completedJobs(),
    })(x.contract, ready(x.workspace))
    expect(result.ok).toBe(false)
    // 可声称：记录带 jobId 但 Session 结果只是前台结构化结果 → 拒绝（kind 与记录不一致）。
    if (!result.ok) expect(result.reason).toContain('foreground Session result but the record names a Job')
  })
})
