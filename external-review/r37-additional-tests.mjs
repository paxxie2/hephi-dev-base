#!/usr/bin/env node
// Additional independent tests for main@8fd199d. No real host or release is touched.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const reviewRoot = dirname(fileURLToPath(import.meta.url))
const script = join(reviewRoot, 'r37-review/scripts/host/deploy-hephi.sh')
const evidenceFile = join(reviewRoot, 'evidence/r37-independent/additional-tests.json')
const workRoot = mkdtempSync(join(reviewRoot, '.r37-additional-'))
const healthNames = ['runtime', 'relay', 'notice', 'launch', 'delivery', 'assessment', 'reply', 'evals', 'models', 'github']
const results = []

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeout ?? 20_000)
    child.on('error', (error) => { clearTimeout(timer); resolveRun({ code: 1, out: `${out}${error.message}` }) })
    child.on('close', (code, signal) => { clearTimeout(timer); resolveRun({ code: code ?? 1, signal, out }) })
  })
}
async function git(repo, args) {
  const result = await run('git', args, { cwd: repo })
  if (result.code !== 0) throw new Error(result.out)
  return result.out.trim()
}
function pointer(instance) { try { return readlinkSync(join(instance, 'hephi/lib')) } catch { return '' } }
function records(instance, kind) {
  const dir = join(instance, 'logs')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json') && (!kind || name.startsWith(`${kind}-`)))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
}
function makeRelease(releases, sha) {
  const dir = join(releases, sha)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  const entry = `export const commit = ${JSON.stringify(sha)}\n`
  writeFileSync(join(dir, 'lib/index.mjs'), entry)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ formatVersion: 1, pluginCommit: sha, sourceTree: sha,
    entrySha256: createHash('sha256').update(entry).digest('hex'), builtAt: '2026-11-07T00:00:00Z',
    buildCommand: 'independent fixture', hostVersion: 'host-1.0.0', source: 'git-archive' }, null, 2))
}
async function makeFixture(name, libMode = 'A') {
  const root = join(workRoot, name)
  const instance = join(root, 'instance')
  const repo = join(root, 'repo')
  const releases = join(instance, 'releases/hephi')
  for (const dir of [join(instance, 'logs'), join(instance, 'hephi'), releases, repo]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(instance, 'host.pid'), '999999\n')
  writeFileSync(join(instance, 'start.sh'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(instance, 'start.sh'), 0o755)
  await git(repo, ['init', '-q', '-b', 'main'])
  await git(repo, ['config', 'user.email', 'review@example.invalid'])
  await git(repo, ['config', 'user.name', 'independent review'])
  writeFileSync(join(repo, 'A.txt'), 'A\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-q', '-m', 'A'])
  const A = await git(repo, ['rev-parse', 'HEAD'])
  writeFileSync(join(repo, 'B.txt'), 'B\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-q', '-m', 'B'])
  const B = await git(repo, ['rev-parse', 'HEAD'])
  makeRelease(releases, A)
  makeRelease(releases, B)
  if (libMode === 'A' || libMode === 'B') symlinkSync(join(releases, libMode === 'A' ? A : B, 'lib'), join(instance, 'hephi/lib'))
  if (libMode === 'directory') {
    mkdirSync(join(instance, 'hephi/lib'))
    writeFileSync(join(instance, 'hephi/lib/legacy.mjs'), '// legacy\n')
  }
  return { root, instance, repo, releases, A, B }
}
async function withFakeHost(fixture, onState, body) {
  const state = { paused: true, health: 'ok', detail: 'ready', failState: false,
    load: { running: 0, queued: 0, startupReservations: 0, effects: 0, jobs: 0, subagents: 0, unknown: 0 } }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/orchestrator/api/state') {
      if (onState) onState(state, fixture)
      if (state.failState) { res.statusCode = 500; res.end('{}'); return }
      const health = Object.fromEntries(healthNames.map((name) => [name, {
        state: state.health === 'bad' && name === 'github' ? 'error' : 'ready',
        detail: name === 'github' ? state.detail : 'ready', at: '2026-11-07T00:00:00Z' }]))
      res.end(JSON.stringify({ paused: state.paused, load: state.load, health }))
      return
    }
    if (url.pathname === '/orchestrator/api/tickets') { res.end('[]'); return }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await body(state, async (args, env = {}) => run('sh', [script, '--instance', fixture.instance,
      '--host', base, '--host-version', 'host-1.0.0', '--repo', fixture.repo,
      '--hephi', join(fixture.instance, 'hephi'), '--releases', fixture.releases, '--timeout', '1', ...args], { env }))
  } finally { await new Promise((resolveClose) => server.close(resolveClose)) }
}
function pass(id, condition, evidence) { results.push({ id, kind: 'expected-behavior', passed: Boolean(condition), evidence }); console.log(`${condition ? 'PASS' : 'FAIL'} ${id}`) }
function defect(id, condition, evidence) { results.push({ id, kind: 'defect-reproduction', reproduced: Boolean(condition), evidence }); console.log(`${condition ? 'REPRODUCED' : 'NOT-REPRODUCED'} ${id}`) }

try {
  // P1: F6 dynamic case. Invalid current must never become a recovery target.
  {
    const fixture = await makeFixture('p1-invalid-current')
    writeFileSync(join(fixture.releases, fixture.A, 'lib/index.mjs'), 'tampered current\n')
    await withFakeHost(fixture, (state) => { state.health = 'bad'; state.detail = 'target-failed' }, async (_state, deploy) => {
      const before = pointer(fixture.instance)
      const result = await deploy(['--rollback', '--target', fixture.B])
      const rec = records(fixture.instance, 'rollback').find((x) => x.result === 'failed-no-previous')
      pass('P1 invalid current is not restored and records failed-no-previous', result.code !== 0 && before !== pointer(fixture.instance)
        && pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib') && rec?.paused === true && String(rec?.targetFailure).includes('target-failed'),
      { exitCode: result.code, output: result.out, pointer: pointer(fixture.instance), record: rec })
    })
  }

  // P2: invalid explicit previous is rejected before any host or pointer side effect.
  {
    const fixture = await makeFixture('p2-invalid-previous')
    await withFakeHost(fixture, null, async (_state, deploy) => {
      const before = pointer(fixture.instance)
      const result = await deploy(['--rollback', '--target', fixture.B, '--previous', 'abc'])
      pass('P2 invalid rollback previous rejected without side effects', result.code !== 0 && /previous must be a full 40-char SHA/.test(result.out)
        && pointer(fixture.instance) === before && records(fixture.instance).length === 0,
      { exitCode: result.code, output: result.out, pointer: pointer(fixture.instance), recordCount: records(fixture.instance).length })
    })
  }

  // P3: ordinary deploy health failure followed by a healthy recovery.
  {
    const fixture = await makeFixture('p3-health-failure-recovery')
    await withFakeHost(fixture, (state) => {
      if (pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib')) { state.health = 'bad'; state.detail = 'target-health-failed' }
      else { state.health = 'ok'; state.detail = 'recovered' }
    }, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.B, '--previous', fixture.A])
      const rec = records(fixture.instance, 'deploy').find((x) => x.result === 'failed-restored-previous')
      pass('P3 target health failure recovers previous to full health', result.code !== 0
        && pointer(fixture.instance) === join(fixture.releases, fixture.A, 'lib') && rec?.restoreHealth === 'all-required-ready'
        && String(rec?.targetFailure).includes('target-health-failed') && rec?.paused === true,
      { exitCode: result.code, output: result.out, pointer: pointer(fixture.instance), record: rec })
    })
  }

  // X1: double failure while the real host is unpaused still claims it was kept paused.
  {
    const fixture = await makeFixture('x1-double-failure-unpaused')
    let targetSeen = false
    await withFakeHost(fixture, (state) => {
      if (pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib')) targetSeen = true
      if (targetSeen) { state.paused = false; state.health = 'bad'; state.detail = 'still-unhealthy' }
    }, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.B, '--previous', fixture.A])
      const rec = records(fixture.instance, 'deploy').find((x) => x.result === 'failed-twice')
      defect('X1 double failure exits with real paused=false but claims kept paused', result.code !== 0 && rec?.paused === false
        && /kept paused/.test(result.out), { exitCode: result.code, output: result.out, record: rec })
    })
  }

  // X2: if restore has no readable state, LAST_STATE from the target attempt is reused as restoreFailure.
  {
    const fixture = await makeFixture('x2-stale-restore-state')
    let targetSeen = false
    await withFakeHost(fixture, (state) => {
      if (pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib')) {
        targetSeen = true; state.health = 'bad'; state.detail = 'target-only-evidence'; state.failState = false
      } else if (targetSeen) state.failState = true
    }, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.B, '--previous', fixture.A])
      const rec = records(fixture.instance, 'deploy').find((x) => x.result === 'failed-twice')
      defect('X2 unreadable restore state is replaced by stale target state', result.code !== 0
        && String(rec?.targetFailure).includes('target-only-evidence') && rec?.restoreFailure === rec?.targetFailure && rec?.paused === 'unverified',
      { exitCode: result.code, output: result.out, record: rec })
    })
  }

  // X3: if restoring the plain directory itself fails, output and record still claim preservation/restoration.
  {
    const fixture = await makeFixture('x3-migration-restore-failure', 'directory')
    const bin = join(fixture.root, 'bin')
    const mvCounter = join(fixture.root, 'mv-counter')
    mkdirSync(bin)
    writeFileSync(mvCounter, '0')
    writeFileSync(join(bin, 'node'), '#!/bin/sh\ncase "$*" in\n  *renameSync*) echo "injected migration rename failure" >&2; exit 42 ;;\nesac\nexec "$REAL_NODE" "$@"\n')
    writeFileSync(join(bin, 'mv'), '#!/bin/sh\nn=$(cat "$MV_COUNTER" 2>/dev/null || echo 0)\nn=$((n+1))\nprintf "%s" "$n" > "$MV_COUNTER"\nif [ "$n" = 2 ]; then echo "injected old-lib restore mv failure" >&2; exit 43; fi\nexec /bin/mv "$@"\n')
    chmodSync(join(bin, 'node'), 0o755)
    chmodSync(join(bin, 'mv'), 0o755)
    await withFakeHost(fixture, null, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.A], { PATH: `${bin}:${process.env.PATH}`, REAL_NODE: process.execPath, MV_COUNTER: mvCounter })
      const rec = records(fixture.instance, 'deploy').find((x) => x.result === 'failed-pointer')
      defect('X3 failed old-directory restore is still reported as restored/preserved', result.code !== 0 && !existsSync(join(fixture.instance, 'hephi/lib'))
        && /cannot restore plain lib directory/.test(result.out) && /old lib directory restored/.test(result.out)
        && /previous state preserved/.test(result.out) && rec?.result === 'failed-pointer',
      { exitCode: result.code, output: result.out, libExists: existsSync(join(fixture.instance, 'hephi/lib')), record: rec })
    })
  }
} finally { rmSync(workRoot, { recursive: true, force: true }) }

const evidence = { schema: 1, reviewedCommit: '8fd199da1d2437ccc9da90a0cfcca64d1646549d', node: process.version,
  executedAt: new Date().toISOString(), note: 'PASS is an expected-behavior check. REPRODUCED confirms a suspected defect; neither is real-host acceptance.', results }
mkdirSync(dirname(evidenceFile), { recursive: true })
writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`Evidence: ${evidenceFile}`)
const failed = results.some((x) => x.kind === 'expected-behavior' ? !x.passed : !x.reproduced)
if (failed) process.exitCode = 1
