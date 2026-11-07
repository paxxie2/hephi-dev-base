/**
 * A6 红队：异常恢复 / A3 解除记录（本地模拟级）。
 *
 * 可声称边界：只证明「下列已列举的恢复路径在本地 CLI + 状态目录夹具下按规则拒绝/放行」。
 * 真实宿主的进程/Job 查询能力（G1 第 9 项、H3）未验证；解除记录只在宿主侧开关打开时生效，
 * 且解除只恢复“重新运行”的资格，绝不把旧执行变成证据。不证明证据不可伪造。
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { main as cliMain, type CliIo } from '../../src/cli.js'
import { runCheck } from '../../src/control/check-runner.js'
import {
  execute, fixture, nativeTools, operatorConfigEnv, outer, ready, resolutionsPath, verifier,
} from './fixtures.js'

import { OPERATOR_RESOLUTIONS_ENV, readResolutions, readRuns } from '../../src/control/check-store.js'

function io(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = []
  return { io: { out: message => out.push(message), err: message => err.push(message) }, out, err }
}

async function cli(args: string[], env?: NodeJS.ProcessEnv) {
  const captured = io()
  const code = await cliMain(args, env ?? await operatorConfigEnv(), captured.io)
  return { code, out: captured.out.join('\n'), err: captured.err.join('\n') }
}

function resolveArgs(stateDir: string, runId: string, overrides: Record<string, string | undefined> = {}): string[] {
  const values: Record<string, string | undefined> = {
    '--ticket': 'ticket-1', '--run': runId, '--basis': 'host-terminal', '--status': 'terminated',
    '--host-query': 'ps -ax: no matching process', '--operator': 'operator-a', '--state-dir': stateDir,
    ...overrides,
  }
  const args = ['resolve']
  for (const [key, value] of Object.entries(values)) if (value !== undefined) args.push(key, value)
  return args
}

/** A background check whose Job registry is unavailable leaves an `unknown` record. */
function backgroundTools() {
  return { execute: async () => ({ isError: false, content: [], value: { kind: 'background', jobId: 'job-1' } }) }
}

async function unknownRecord() {
  const f = await fixture()
  const record = await execute(f, 'build', backgroundTools() as never)
  expect(record.status).toBe('unknown')
  return { f, record }
}

describe('恢复流程（A3 CLI + verifier）', () => {
  it('RT-REC-01: resolving an execution the host still reports as running is refused', async () => {
    const { f, record } = await unknownRecord()
    const result = await cli(resolveArgs(f.stateDir, record.runId, { '--status': 'running' }))
    expect(result.code).not.toBe(0)
    // 可声称：宿主报告仍在运行 → CLI 拒绝，且不写解除记录。
    expect(result.err).toContain('still reports the check as running')
    await expect(readFile(resolutionsPath(f.stateDir, f.c.ticketId), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('RT-REC-02: an unresolved unknown run blocks ready with the recovery gate', async () => {
    const { f } = await unknownRecord()
    const result = await verifier(f)(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：未解除的 running/unknown 记录阻塞 ready，进入 A3 恢复流程。
    if (!result.ok) expect(result.reason).toContain('unfinished/unsupported check execution')
  })

  it('RT-REC-03: an enabled resolution only restores retry eligibility; the old run never becomes evidence', async () => {
    const { f, record } = await unknownRecord()
    const result = await cli(resolveArgs(f.stateDir, record.runId))
    expect(result.code).toBe(0)
    expect((await readResolutions(f.stateDir, f.c.ticketId)).length).toBe(1)
    const stillNotEvidence = await verifier(f, { allowOperatorResolutions: true })(f.c, ready(f.r.dir))
    expect(stillNotEvidence.ok).toBe(false)
    // 可声称：解除后旧 unknown 运行仍不是通过证据（只恢复重新运行的资格）。
    if (!stillNotEvidence.ok) expect(stillNotEvidence.reason).toContain('missing, failed or stale evidence')
    const [stored] = await readRuns(f.stateDir, f.c.ticketId)
    expect(stored!.status).toBe('unknown')
  })

  it('RT-REC-04: the CLI refuses every resolution while the host switch is off', async () => {
    const { f, record } = await unknownRecord()
    const result = await cli(resolveArgs(f.stateDir, record.runId), await operatorConfigEnv(false))
    expect(result.code).not.toBe(0)
    // 可声称：宿主开关关闭时 CLI 拒绝，且不写任何记录（Worker 不能自行打开该路径）。
    expect(result.err).toContain(OPERATOR_RESOLUTIONS_ENV)
    await expect(readFile(resolutionsPath(f.stateDir, f.c.ticketId), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('合法对照：解除后重新运行可以通过', () => {
  it('RT-REC-LEGAL-01: after a recorded resolution, fresh checks pass ready', async () => {
    const { f, record } = await unknownRecord()
    expect((await cli(resolveArgs(f.stateDir, record.runId))).code).toBe(0)
    for (const id of ['build', 'unit']) {
      await runCheck({
        stateDir: f.stateDir, contract: f.c, checkId: id, outer: outer(id), tools: nativeTools(),
        allowOperatorResolutions: true,
      })
    }
    expect(await verifier(f, { allowOperatorResolutions: true })(f.c, ready(f.r.dir))).toEqual({ ok: true })
    // 可声称：解除记录 + 重新执行产生的真实（fixture）记录可以通过；不沿用旧执行结果。
  })
})
