import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
// hephi/tests/eval -> repository root (eval/, scripts/ live there)
const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-eval-cli-'))
  cleanup.push(dir)
  return dir
}
async function spawn(file: string, args: string[], cwd = repo): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await run(file, args, { cwd, env: process.env })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}
const cli = (args: string[], cwd = repo) => spawn('node', args, cwd)
const shell = (args: string[], cwd = repo) => spawn('sh', args, cwd)

describe('eval CLI scripts (integration)', () => {
  it('kappa passes at full agreement and fails below the threshold', async () => {
    const dir = await temp()
    const perfect = join(dir, 'perfect.json')
    const low = join(dir, 'low.json')
    await writeFile(perfect, JSON.stringify({ labels: ['pass', 'fail'], items: [
      { id: '1', raterA: 'pass', raterB: 'pass' }, { id: '2', raterA: 'fail', raterB: 'fail' },
    ] }))
    await writeFile(low, JSON.stringify({ labels: ['pass', 'fail'], items: [
      { id: '1', raterA: 'pass', raterB: 'fail' }, { id: '2', raterA: 'fail', raterB: 'pass' },
    ] }))
    const ok = await cli(['eval/kappa.mjs', '--scores', perfect])
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.stdout)).toMatchObject({ kappa: 1, pass: true })
    const bad = await cli(['eval/kappa.mjs', '--scores', low])
    expect(bad.code).toBe(1)
    expect(JSON.parse(bad.stdout).pass).toBe(false)
    expect((await cli(['eval/kappa.mjs', '--scores', join(dir, 'missing.json')])).code).toBe(2)
  })

  it('exports a baseline archive with relation tables and verifies it end to end', async () => {
    const dir = await temp()
    const db = join(dir, 'orchestrator.sqlite')
    await run('sqlite3', [db, [
      'create table ticket(id text primary key, value text not null);',
      'create table trigger(id text primary key, value text not null, at text not null);',
      'create table disposition(id text primary key, value text not null);',
      'create table thread(key text primary key, value text not null);',
      'create table trigger_thread(thread text not null, id text not null, at text not null, human integer not null);',
      `insert into ticket values('t1', '{"id":"t1","title":"fixture","createdAt":"2026-11-01T00:00:00Z","assignments":[{"id":"a1"}],"ended":{"at":"2026-11-02T00:00:00Z","by":"human","outcome":"merged"}}');`,
      `insert into trigger values('g1', '{"id":"g1"}', '2026-11-01T00:00:00Z');`,
      `insert into disposition values('d1', '{"id":"d1"}');`,
      `insert into thread values('github:1', '{"key":"github:1"}');`,
      `insert into trigger_thread values('github:1', 'g1', '2026-11-01T00:00:00Z', 1);`,
    ].join('\n')])
    const out = join(dir, 'archive')
    const exportResult = await cli(['eval/export-baseline.mjs', '--db', db, '--out', out])
    expect(exportResult.code).toBe(0)
    const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'))
    expect(summary).toMatchObject({ total: 1, triggers: 1, dispositions: 1, threads: 1, triggerThreads: 1 })
    const check = await cli(['eval/check-baseline.mjs', '--archive', out])
    expect(check.code).toBe(0)
    expect(JSON.parse(check.stdout).ok).toBe(true)
    // 篡改关系文件并保留旧哈希 -> 必须报 SHA256 不符
    await writeFile(join(out, 'triggers.json'), 'tampered')
    const tampered = await cli(['eval/check-baseline.mjs', '--archive', out])
    expect(tampered.code).toBe(1)
    expect(JSON.parse(tampered.stdout).problems).toContain('triggers.json SHA256 不符')
    // 缺失数据库 -> 明确失败
    expect((await cli(['eval/export-baseline.mjs', '--db', join(dir, 'nope.sqlite'), '--out', join(dir, 'x')])).code).toBe(2)
  })

  it('checks role conflicts, budget appendix and data packages', async () => {
    const dir = await temp()
    const roles = join(dir, 'roles.json')
    await writeFile(roles, JSON.stringify({
      people: [{ id: 'a', develops: true }, { id: 'b', develops: false }, { id: 'c', develops: false, blindRater: true }, { id: 'd', develops: false, blindRater: true }, { id: 'e', develops: false, adjudicator: true }],
      tasks: [{ id: 't1', author: 'a', scopeReviewer: 'b' }],
      scoring: { blindRaters: ['c', 'd'], adjudicator: 'e' },
    }))
    expect((await cli(['eval/check-roles.mjs', '--roles', roles])).code).toBe(0)
    const conflicts = join(dir, 'roles-bad.json')
    await writeFile(conflicts, JSON.stringify({
      people: [{ id: 'a', develops: true }, { id: 'b', develops: false }, { id: 'c', develops: true }, { id: 'd', develops: false }, { id: 'e', develops: false }],
      tasks: [{ id: 't1', author: 'a', scopeReviewer: 'a' }],
      scoring: { blindRaters: ['c', 'd'], adjudicator: 'c' },
    }))
    expect((await cli(['eval/check-roles.mjs', '--roles', conflicts])).code).toBe(1)

    const prereg = join(dir, 'PREREG.md')
    await writeFile(prereg, '# 预注册\n- 币种：CNY\n- 金额：¥ 12000\n- 单次运行上限：¥ 300\n- 总预算上限：¥ 12000\n- 停止规则：触达上限即停止\n- 负责人：paxxie2\n')
    expect((await cli(['eval/check-budget.mjs', '--prereg', prereg])).code).toBe(0)

    const clean = join(dir, 'pkg-clean')
    await mkdir(clean, { recursive: true })
    await writeFile(join(clean, 'readme.md'), 'review material')
    expect((await cli(['eval/check-data-package.mjs', '--package', clean])).code).toBe(0)
    const bad = join(dir, 'pkg-bad')
    await mkdir(bad, { recursive: true })
    await writeFile(join(bad, 'token.txt'), 'ghp_abcdefghijklmnopqrstuvwxyz012345')
    await symlink(clean, join(bad, 'link'))
    const dataBad = await cli(['eval/check-data-package.mjs', '--package', bad])
    expect(dataBad.code).toBe(1)
    const kinds = JSON.parse(dataBad.stdout).findings.map((finding: { kind: string }) => finding.kind)
    expect(kinds).toContain('github-token')
    expect(kinds).toContain('symlink')
  })

  it('compares visible surfaces and runs repeated offline commands', async () => {
    const dir = await temp()
    const surface = (extra: string[] = []) => ({ tools: ['read', 'bash', ...extra], skills: ['hephi-superagent-control'], promptSha256: 'a'.repeat(64) })
    const files = {
      a: join(dir, 'a.json'), b: join(dir, 'b.json'), c: join(dir, 'c.json'), c2: join(dir, 'c2.json'),
    }
    await writeFile(files.a, JSON.stringify(surface()))
    await writeFile(files.b, JSON.stringify(surface()))
    await writeFile(files.c, JSON.stringify(surface()))
    await writeFile(files.c2, JSON.stringify(surface(['hephi_check'])))
    expect((await cli(['scripts/experimental/check-shadow-parity.mjs', '--no-plugin', files.a, '--no-label', files.b, '--shadow', files.c])).code).toBe(0)
    expect((await cli(['scripts/experimental/check-shadow-parity.mjs', '--no-plugin', files.a, '--no-label', files.b, '--shadow', files.c2])).code).toBe(1)

    const pass = await shell(['scripts/experimental/check-dubbo-offline.sh', '--dir', dir, '--command', 'true', '--runs', '2', '--expect', 'pass'])
    expect(pass.code).toBe(0)
    const fail = await shell(['scripts/experimental/check-dubbo-offline.sh', '--dir', dir, '--command', 'true', '--runs', '2', '--expect', 'fail'])
    expect(fail.code).toBe(1)
  })
})
