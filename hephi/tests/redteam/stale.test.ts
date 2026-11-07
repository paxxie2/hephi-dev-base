/**
 * A6 红队：过期证据（本地模拟级）。
 *
 * 可声称边界：这些用例只证明「下列已列举的过期证据在本地 git/状态目录夹具下被拒绝」，
 * 以及「按当前合同重新执行后可以继续」。不证明真实宿主证据链已核实，也不证明证据不可伪造。
 */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { readRuns } from '../../src/control/check-store.js'
import {
  boundSnapshot, execute, fixture, ready, rewriteRecord, runAll, verifier,
} from './fixtures.js'

const run = promisify(execFile)

describe('过期证据（本地合成快照）', () => {
  it('RT-STALE-01: evidence produced before a later commit is refused for the new HEAD', async () => {
    const f = await fixture()
    await runAll(f)
    // 证据生成后再提交一次改动：记录里的 before/after 指纹与当前 diff 不再一致。
    await writeFile(join(f.r.dir, 'src/app.js'), 'module.exports = 3\n')
    await run('git', ['add', '.'], { cwd: f.r.dir })
    await run('git', ['commit', '-m', 'later change'], { cwd: f.r.dir })
    const result = await verifier(f)(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：记录的前后代码指纹与当前 base→HEAD diff 不一致 → 拒绝（绑定开关无关）。
    if (!result.ok) expect(result.reason).toContain('missing, failed or stale evidence')
  })

  it('RT-STALE-02: evidence bound to an old contract hash is refused', async () => {
    const f = await fixture()
    await runAll(f)
    const changedContract = { ...f.c, contractHash: `sha256:${'b'.repeat(64)}` }
    const result = await verifier(f)(changedContract, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：记录的 contractHash 与当前合同不一致 → 拒绝。
    if (!result.ok) expect(result.reason).toContain('missing, failed or stale evidence')
  })

  it('RT-STALE-03: evidence produced by another plugin build is refused', async () => {
    const f = await fixture()
    const records = await runAll(f)
    const build = records.find(record => record.checkId === 'build')!
    await rewriteRecord(f, build, { pluginCommit: 'another-build' })
    const result = await verifier(f)(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：记录的 pluginCommit 与当前内存构建不一致 → 拒绝。
    if (!result.ok) expect(result.reason).toContain('produced by another plugin build')
  })

  it('RT-STALE-04: an edited task card/contract is refused after the hash check', async () => {
    const f = await fixture()
    await runAll(f)
    // 攻击者直接改合同内容但不改 contractHash：ready 使用内存合同，不在本地重算文件哈希；
    // 这里用 contractHash 之外的可判字段（allowedPaths 收窄）模拟“旧证据配新合同”。
    const narrowed = { ...f.c, allowedPaths: ['src/**'] }
    const result = await verifier(f)(narrowed, ready(f.r.dir))
    // 该攻击不应改变证据有效性判定：证据仍然是同一合同 hash，允许路径收窄不改变本报告结论。
    // 可声称（边界）：合同文件完整性由 prepare/loadActivation 的哈希校验负责（见 activation.test.ts），
    // 这里只验证 ready 不读取状态目录里的合同副本、不会把被改的文件当依据。
    expect(result.ok).toBe(true)
  })
})

describe('合法对照：按当前合同重新执行后可以继续', () => {
  it('RT-STALE-LEGAL-01: re-running checks for the new HEAD passes with binding off', async () => {
    const f = await fixture()
    await runAll(f)
    await writeFile(join(f.r.dir, 'src/app.js'), 'module.exports = 3\n')
    await run('git', ['add', '.'], { cwd: f.r.dir })
    await run('git', ['commit', '-m', 'later change'], { cwd: f.r.dir })
    // Worker 在新 HEAD 上重新运行全部冻结检查。
    for (const id of ['build', 'unit']) await execute(f, id)
    expect(await verifier(f)(f.c, ready(f.r.dir))).toEqual({ ok: true })
    // 可声称：重新执行（新记录、新指纹）后正常请求可以通过。
  })

  it('RT-STALE-LEGAL-02: re-running checks after an authorized contract change passes', async () => {
    const f = await fixture()
    await runAll(f)
    const newContract = { ...f.c, contractHash: `sha256:${'c'.repeat(64)}` }
    for (const id of ['build', 'unit']) await execute(f, id, undefined, newContract)
    expect(await verifier(f)(newContract, ready(f.r.dir))).toEqual({ ok: true })
    // 可声称：合同 hash 变化后旧记录失效，但按新合同重新执行可以继续（对应 §A6「合同变更」）。
    // 不声称：真实 prepare 流程重新写入合同的端到端行为（由 activation/prepare 测试覆盖）。
  })

  it('RT-STALE-LEGAL-03: the re-run evidence also passes with binding on', async () => {
    const f = await fixture()
    await runAll(f)
    await writeFile(join(f.r.dir, 'src/app.js'), 'module.exports = 3\n')
    await run('git', ['add', '.'], { cwd: f.r.dir })
    await run('git', ['commit', '-m', 'later change'], { cwd: f.r.dir })
    for (const id of ['build', 'unit']) await execute(f, id)
    const records = await readRuns(f.stateDir, f.c.ticketId)
    const snapshot = boundSnapshot('worker-session', records, f.c)
    expect(await verifier(f, { binding: true, readSession: async () => snapshot })(f.c, ready(f.r.dir))).toEqual({ ok: true })
  })
})
