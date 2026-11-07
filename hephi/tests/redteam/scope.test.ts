/**
 * A6 红队：范围约束（本地模拟级）。
 *
 * 可声称边界：只证明「下列已列举的越界形式在本地 git/路径检查下被拒绝」以及「范围内正常修改可完成」。
 * `git stash` 隐藏期间的不可见性是**已知限制**（本地 ready 看不到 stash 内容），恢复后必须拒绝；
 * 不证明真实宿主上的权限边界（A4 未验证），也不证明证据不可伪造。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { allowedPath } from '../../src/control/repository.js'
import { checkoutRelative } from '../../src/control/workspace.js'
import { cleanup, fixture, ready, runAll, verifier } from './fixtures.js'

const run = promisify(execFile)
const extra: string[] = []
afterEach(async () => { await Promise.all(extra.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function committed(f: Awaited<ReturnType<typeof fixture>>, path: string, body: string): Promise<void> {
  await writeFile(join(f.r.dir, path), body)
  await run('git', ['add', '.'], { cwd: f.r.dir })
  await run('git', ['commit', '-m', `edit ${path}`], { cwd: f.r.dir })
}

describe('范围约束（本地 git / 路径检查）', () => {
  it('RT-SCOPE-01: a committed out-of-scope change is refused by the ready diff check', async () => {
    const f = await fixture({ allowedPaths: ['src/**'] })
    await runAll(f)
    // 攻击者用 shell 写越界文件并提交（绕过编辑工具）。
    await committed(f, 'docs/notes.md', 'shell wrote this\n')
    const result = await verifier(f)(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：提交后的 base→HEAD diff 含允许路径外文件 → ready 拒绝。
    if (!result.ok) expect(result.reason).toContain('outside the task scope')
  })

  it('RT-SCOPE-02: an uncommitted out-of-scope write is refused by the clean-tree check', async () => {
    const f = await fixture({ allowedPaths: ['src/**'] })
    await runAll(f)
    await writeFile(join(f.r.dir, 'docs/notes.md'), 'dirty out-of-scope write\n')
    const result = await verifier(f)(f.c, ready(f.r.dir))
    expect(result.ok).toBe(false)
    // 可声称：工作树不干净 → ready 拒绝。
    if (!result.ok) expect(result.reason).toContain('repository/base/clean check failed')
  })

  it('RT-SCOPE-03: a symlink escape is not mapped into the checkout and is not an allowed path', async () => {
    const f = await fixture({ allowedPaths: ['src/**'] })
    const outside = await mkdtemp(join(tmpdir(), 'hephi-redteam-outside-'))
    extra.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'outside\n')
    await symlink(outside, join(f.r.dir, 'src/escape'), 'dir')
    // 直接核对路径层：符号链接逃逸解析不到 checkout 内相对路径。
    expect(await checkoutRelative(f.r.dir, f.r.dir, 'src/escape/secret.txt')).toBeUndefined()
    // 越界路径也不在 allowedPaths 内。
    expect(allowedPath('docs/notes.md', ['src/**'])).toBe(false)
    expect(allowedPath('../etc/passwd', ['src/**'])).toBe(false)
    expect(allowedPath('src/app.js', ['src/**'])).toBe(true)
    // 可声称：路径映射与 allowedPath 两层都拒绝逃逸；不声称已覆盖所有符号链接时序/竞态。
  })

  it('RT-SCOPE-04: hiding an out-of-scope edit in git stash is invisible while hidden (known limit) and refused after restore', async () => {
    const f = await fixture({ allowedPaths: ['src/**'] })
    await runAll(f)
    await writeFile(join(f.r.dir, 'docs/notes.md'), 'stashed out-of-scope edit\n')
    await run('git', ['stash', 'push', '--', 'docs/notes.md'], { cwd: f.r.dir })
    // 可声称（边界）：stash 隐藏时工作树干净，本地 ready 看不到 stash 里的内容，因此仍可通过。
    // 这是已知限制（README 已知限制 #1 的同类），不是“已修复”；不得据此声称证据不可伪造。
    expect(await verifier(f)(f.c, ready(f.r.dir))).toEqual({ ok: true })
    await run('git', ['stash', 'pop'], { cwd: f.r.dir })
    const restored = await verifier(f)(f.c, ready(f.r.dir))
    expect(restored.ok).toBe(false)
    // 可声称：恢复后的越界改动使工作树不干净 → ready 拒绝。
    if (!restored.ok) expect(restored.reason).toContain('repository/base/clean check failed')
  })
})

describe('合法对照', () => {
  it('RT-SCOPE-LEGAL-01: an in-scope committed change with fresh checks passes', async () => {
    const f = await fixture({ allowedPaths: ['src/**'] })
    await runAll(f)
    expect(await verifier(f)(f.c, ready(f.r.dir))).toEqual({ ok: true })
    // 可声称：范围内的正常修改在本地夹具下可以完成。
  })
})
