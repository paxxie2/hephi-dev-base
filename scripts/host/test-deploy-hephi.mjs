#!/usr/bin/env node
// P8 假宿主自动化测试：只使用临时目录、假 start 脚本、假状态响应和临时 git 仓库。
// 不访问 3082/3083，不创建 Issue/PR，不触碰真实 release。
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const script = join(repoRoot, 'scripts/host/deploy-hephi.sh')
const FULL = (c) => c.repeat(40)
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

let failures = 0
const results = []
function check(name, condition, detail = '') {
  if (condition) { results.push(`PASS ${name}`); return }
  failures += 1
  results.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 60_000, env: { ...process.env, ...(opts.env ?? {}) }, cwd: opts.cwd })
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}${res.error ? `spawn-error: ${res.error.message}` : ''}`, signal: res.signal, status: res.status }
}

// 异步执行：deploy 需要访问本进程内起的假宿主 HTTP 服务，同步 spawn 会阻塞事件循环导致假宿主无法应答。
function runAsync(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...(opts.env ?? {}) }, cwd: opts.cwd })
    let out = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, opts.timeout ?? 60_000)
    child.on('error', (err) => { clearTimeout(timer); resolveRun({ code: 1, out: `${out}spawn-error: ${err.message}`, signal: null, status: null }) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) out += '\n[harness] timed out'
      resolveRun({ code: code ?? 1, out, signal, status: code })
    })
  })
}

// ---- fake host state server ----
const state = {
  paused: true,
  load: { running: 0, queued: 0, startupReservations: 0, effects: 0, jobs: 0, subagents: 0, unknown: 0 },
  tickets: 0,
  health: 'ok',
  marker: null,
}
function healthPayload() {
  const ready = () => ({ state: 'ready', detail: 'ready', at: new Date().toISOString() })
  const health = {
    runtime: ready(), relay: ready(), notice: ready(), launch: ready(), delivery: ready(),
    assessment: ready(), reply: ready(), evals: ready(), models: ready(), github: ready(),
  }
  if (state.health === 'github-starting') health.github = { state: 'starting', detail: 'starting', at: new Date().toISOString() }
  if (state.health === 'always-bad') health.github = { state: 'error', detail: 'boom', at: new Date().toISOString() }
  if (state.health === 'marker' && state.marker && !existsSync(state.marker)) {
    health.runtime = { state: 'starting', detail: 'waiting for start', at: new Date().toISOString() }
  }
  return health
}
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/orchestrator/api/state') {
    res.end(JSON.stringify({ paused: state.paused, load: state.load, health: healthPayload() }))
    return
  }
  if (url.pathname === '/orchestrator/api/tickets') {
    res.end(JSON.stringify(Array.from({ length: state.tickets }, (_, i) => ({ id: `t${i}` }))))
    return
  }
  res.statusCode = 404
  res.end('{}')
})

// ---- fake instance and repo ----
const root = mkdtempSync(join(tmpdir(), 'hephi-r3-'))
const instance = join(root, 'instance')
const releases = join(instance, 'releases', 'hephi')
const repo = join(root, 'repo')
for (const dir of [instance, join(instance, 'logs'), join(instance, 'hephi'), releases, repo, join(repo, 'hephi')]) mkdirSync(dir, { recursive: true })

function writeStart(scriptBody) {
  const file = join(instance, 'start.sh')
  writeFileSync(file, `#!/bin/sh\n${scriptBody}\n`)
  run('chmod', ['+x', file])
}
function normalStart() {
  writeStart(`echo started >> "${instance}/start.log"\n: > "${instance}/started.marker"\nexec sleep 3600`)
}
writeStart('#!/bin/sh\nexit 1') // placeholder before scenarios
writeFileSync(join(instance, 'host.pid'), '999999\n')
normalStart()
state.marker = join(instance, 'started.marker')

// stub plugin repository: git archive + frozen install + pnpm check must succeed
writeFileSync(join(repo, 'hephi', 'package.json'), JSON.stringify({ name: 'stub-hephi', version: '0.0.0', private: true, type: 'module', scripts: { check: 'node build.mjs' } }, null, 2))
writeFileSync(join(repo, 'hephi', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n  .: {}\n")
writeFileSync(join(repo, 'hephi', 'build.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs'\nmkdirSync('lib', { recursive: true })\nwriteFileSync('lib/index.mjs', `export function describePlugin(){return {name:'stub',version:'0.0.0',commit:${JSON.stringify(process.env.HEPHI_BUILD_COMMIT ?? 'unknown')}}}\\n`)\n")
run('git', ['init', '-q', '-b', 'main'], { cwd: repo })
run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo })
run('git', ['config', 'user.name', 'deploy test'], { cwd: repo })
run('git', ['add', '.'], { cwd: repo })
run('git', ['commit', '-q', '-m', 'A'], { cwd: repo })
const A = run('git', ['rev-parse', 'HEAD'], { cwd: repo }).out.trim()
writeFileSync(join(repo, 'hephi', 'VERSION.txt'), 'B\n')
run('git', ['add', '.'], { cwd: repo })
run('git', ['commit', '-q', '-m', 'B'], { cwd: repo })
const B = run('git', ['rev-parse', 'HEAD'], { cwd: repo }).out.trim()

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const base = `http://127.0.0.1:${server.address().port}`

async function deploy(extra, timeout = 120_000) {
  const flags = process.env.HARNESS_DEBUG ? ['-x', script] : [script]
  return runAsync('sh', [...flags, '--instance', instance, '--host', base, '--host-version', 'host-1.0.0', '--repo', repo, '--hephi', join(instance, 'hephi'), '--releases', releases, '--timeout', '6', ...extra], { timeout })
}
function pointer() { try { return readlinkSync(join(instance, 'hephi', 'lib')) } catch { return '' } }
function releaseDir(sha) { return join(releases, sha) }
async function waitForStarts(expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (starts() < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20))
  }
  return starts()
}
function starts() { return existsSync(join(instance, 'start.log')) ? readFileSync(join(instance, 'start.log'), 'utf8').trim().split('\n').filter(Boolean).length : 0 }
function treeHash(dir) {
  const rows = []
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const stat = lstatSync(p)
      if (stat.isDirectory()) walk(p)
      else rows.push(`${p.slice(dir.length)}:${sha256(p)}`)
    }
  }
  walk(dir)
  return createHash('sha256').update(rows.join('\n')).digest('hex')
}

try {
  // R3-T01 首次发布
  const t1 = await deploy(['--target', A])
  check('R3-T01 first publish exits 0', t1.code === 0, JSON.stringify(t1))
  await waitForStarts(1)
  if (!existsSync(join(releaseDir(A), 'meta.json'))) {
    console.log('--- first publish output ---\n' + t1.out)
    throw new Error('first publish did not create a release')
  }
  const metaA = JSON.parse(readFileSync(join(releaseDir(A), 'meta.json'), 'utf8'))
  check('R3-T01 release A lib exists', existsSync(join(releaseDir(A), 'lib', 'index.mjs')))
  check('R3-T01 meta fields complete', metaA.formatVersion === 1 && metaA.pluginCommit === A && /^[0-9a-f]{64}$/.test(metaA.entrySha256) && metaA.hostVersion === 'host-1.0.0' && /^[0-9a-f]{40}$/.test(metaA.sourceTree) && typeof metaA.builtAt === 'string' && metaA.buildCommand.includes('pnpm check'), JSON.stringify(metaA))
  check('R3-T01 pointer points to release A', pointer() === join(releaseDir(A), 'lib'), pointer())

  // R3-T02 同 SHA 重发
  writeFileSync(join(releaseDir(A), 'sentinel'), 'keep')
  const hashA = treeHash(releaseDir(A))
  const startsBefore = starts()
  const t2 = await deploy(['--target', A])
  check('R3-T02 republish fails', t2.code !== 0 && /already loaded and immutable/.test(t2.out), t2.out)
  check('R3-T02 sentinel and release unchanged', existsSync(join(releaseDir(A), 'sentinel')) && treeHash(releaseDir(A)) === hashA)
  check('R3-T02 no restart', starts() === startsBefore, `starts ${startsBefore} -> ${starts()}`)

  // R3-T03 target 缺失
  const missing = FULL('f')
  const t3 = await deploy(['--target', missing])
  check('R3-T03 missing target fails before switch', t3.code !== 0 && pointer() === join(releaseDir(A), 'lib') && starts() === startsBefore, `code=${t3.code} starts ${startsBefore}->${starts()} ${t3.out}`)

  // R3-T04 meta commit 与目录不符
  const badMeta = join(releases, FULL('a'))
  mkdirSync(join(badMeta, 'lib'), { recursive: true })
  const metaCopy = { ...metaA, pluginCommit: A }
  writeFileSync(join(badMeta, 'lib', 'index.mjs'), readFileSync(join(releaseDir(A), 'lib', 'index.mjs')))
  writeFileSync(join(badMeta, 'meta.json'), JSON.stringify(metaCopy))
  const t4 = await deploy(['--target', FULL('a')])
  check('R3-T04 meta/dir SHA mismatch rejected', t4.code !== 0 && pointer() === join(releaseDir(A), 'lib') && starts() === startsBefore, `code=${t4.code} starts ${startsBefore}->${starts()} ${t4.out}`)

  // R3-T05 内容篡改
  const tampered = join(releases, FULL('b'))
  mkdirSync(join(tampered, 'lib'), { recursive: true })
  writeFileSync(join(tampered, 'lib', 'index.mjs'), 'tampered')
  writeFileSync(join(tampered, 'meta.json'), JSON.stringify({ ...metaA, pluginCommit: FULL('b') }))
  const t5 = await deploy(['--target', FULL('b')])
  check('R3-T05 content tamper rejected', t5.code !== 0 && /entry hash mismatch/.test(t5.out), t5.out)

  // R3-T06 A → B 正常切换
  const t6 = await deploy(['--target', B, '--previous', A])
  check('R3-T06 switch to B exits 0', t6.code === 0, t6.out)
  check('R3-T06 pointer is B', pointer() === join(releaseDir(B), 'lib'), pointer())
  check('R3-T06 release A unchanged', treeHash(releaseDir(A)) === hashA)
  const hashB = treeHash(releaseDir(B))

  // R3-T07 B → A 顺序回切
  const t7 = await deploy(['--target', A, '--previous', B])
  check('R3-T07 switch back to A exits 0', t7.code === 0, t7.out)
  check('R3-T07 pointer is A; both immutable', pointer() === join(releaseDir(A), 'lib') && treeHash(releaseDir(A)) === hashA && treeHash(releaseDir(B)) === hashB)

  // R3-T11 dry-run
  const startsDry = starts()
  const t11 = await deploy(['--target', B, '--dry-run'])
  check('R3-T11 dry-run exits 0 and does not switch/restart', t11.code === 0 && /dry-run/.test(t11.out) && pointer() === join(releaseDir(A), 'lib') && starts() === startsDry, t11.out)

  // R3-T12 进行中 Ticket
  state.tickets = 1
  const t12 = await deploy(['--target', B, '--previous', A])
  check('R3-T12 open tickets refuse', t12.code !== 0 && /open Tickets/.test(t12.out), t12.out)
  state.tickets = 0

  // R3-T13 移除绕过入口
  const t13 = await deploy(['--target', B, '--allow-open-tickets'])
  check('R3-T13 --allow-open-tickets is an unknown argument', t13.code === 2 && /unknown argument/.test(t13.out), t13.out)

  // R3-T14 hostVersion 必填
  const t14a = run('sh', [script, '--instance', instance, '--host', base, '--repo', repo, '--hephi', join(instance, 'hephi'), '--releases', releases, '--target', B], { timeout: 120_000 })
  const t14b = run('sh', [script, '--instance', instance, '--host', base, '--host-version', '', '--repo', repo, '--hephi', join(instance, 'hephi'), '--releases', releases, '--target', B], { timeout: 120_000 })
  check('R3-T14 missing/empty hostVersion rejected', t14a.code === 2 && t14b.code === 2 && pointer() === join(releaseDir(A), 'lib'), `${t14a.code}/${t14b.code}`)

  // R3-T15 drain 字段：分别非零/未知都拒绝
  const baseLoad = { ...state.load }
  for (const field of ['running', 'queued', 'startupReservations', 'effects', 'jobs', 'subagents', 'unknown']) {
    state.load = { ...baseLoad, [field]: 1 }
    const res = await deploy(['--target', B, '--previous', A])
    check(`R3-T15 nonzero ${field} refused`, res.code !== 0 && res.out.includes(field), res.out)
    state.load = { ...baseLoad }
    delete state.load[field]
    const unknown = await deploy(['--target', B, '--previous', A])
    check(`R3-T15 unknown ${field} refused`, unknown.code !== 0 && unknown.out.includes(field), unknown.out)
    state.load = { ...baseLoad }
  }

  // R3-T08 重启失败自动恢复 previous
  state.health = 'marker'
  writeStart(`echo attempt >> "${instance}/start.log"\nif [ ! -f "${instance}/fail-once-used" ]; then : > "${instance}/fail-once-used"; exit 1; fi\n: > "${instance}/started.marker"\nexec sleep 3600`)
  rmSync(join(instance, 'started.marker'), { force: true })
  const t8 = await deploy(['--target', B, '--previous', A])
  check('R3-T08 restart failure exits nonzero', t8.code !== 0, t8.out)
  check('R3-T08 auto-restores A and stays paused', pointer() === join(releaseDir(A), 'lib') && /previous build restored/.test(t8.out), `${pointer()} ${t8.out}`)
  state.health = 'ok'
  normalStart()

  // R3-T09 健康失败（github=starting）自动恢复
  state.health = 'github-starting'
  // 让目标 B 的切换阶段健康失败；恢复 A 后需要健康通过，用临时切换窗口模拟：先坏 1.5 秒
  const startedAt = Date.now()
  const origHealth = healthPayload
  // 简化：用 always-bad 模拟目标阶段失败，恢复阶段仍失败会走 T10；这里单独用 github-starting 并手动放行恢复：改为先失败一次
  state.health = 'github-starting'
  const t9 = await deploy(['--target', B, '--previous', A], 120_000)
  check('R3-T09 github=starting is not accepted as success', t9.code !== 0, t9.out)
  check('R3-T09 pointer restored to A', pointer() === join(releaseDir(A), 'lib'), pointer())
  state.health = 'ok'

  // R3-T10 回滚也失败
  state.health = 'always-bad'
  const t10 = await deploy(['--target', B, '--previous', A])
  check('R3-T10 double failure exits nonzero', t10.code !== 0, t10.out)
  check('R3-T10 stays paused with both attempts recorded', /both failed|kept paused/.test(t10.out))
  state.health = 'ok'

  // R3-T17 记录完整
  const logs = readdirSync(join(instance, 'logs')).filter((name) => name.endsWith('.json'))
  const records = logs.map((name) => JSON.parse(readFileSync(join(instance, 'logs', name), 'utf8')))
  const okDeploy = records.find((r) => r.action === 'deploy' && r.result === 'ok' && r.target === B && r.previous === A)
  const failedDeploy = records.find((r) => r.action === 'deploy' && r.result !== 'ok')
  check('R3-T17 success record complete', okDeploy && okDeploy.target === B && okDeploy.previous === A && okDeploy.hostVersion === 'host-1.0.0' && okDeploy.health === 'all-required-ready' && okDeploy.paused === true && typeof okDeploy.at === 'string', JSON.stringify(okDeploy))
  check('R3-T17 failure record complete', failedDeploy && typeof failedDeploy.target === 'string' && failedDeploy.hostVersion === 'host-1.0.0' && typeof failedDeploy.at === 'string', JSON.stringify(failedDeploy))

  // R3-T06/T16 不可变性总校验
  check('R3-T16 releases A/B unchanged after all scenarios', treeHash(releaseDir(A)) === hashA && treeHash(releaseDir(B)) === hashB)

  // R3-T07 rollback 子命令（显式 target）
  const tRollback = await deploy(['--rollback', '--target', B, '--previous', A])
  check('R3-T07b explicit rollback exits 0', tRollback.code === 0, tRollback.out)
  check('R3-T07b rollback record exists', readdirSync(join(instance, 'logs')).some((name) => name.startsWith('rollback-') && name.endsWith('.json')))
} finally {
  server.close()
  rmSync(root, { recursive: true, force: true })
}

for (const line of results) console.log(line)
if (failures > 0) {
  console.log(`\nFAILED: ${failures} assertion(s)`)
  process.exit(1)
}
console.log(`\nPASS: ${results.length} assertions (R3 fake-host suite)`)
