#!/usr/bin/env node
// Independent negative tests for PR #20. Uses only isolated directories and fake hosts.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const reviewRoot = dirname(fileURLToPath(import.meta.url))
const script = join(reviewRoot, 'pr20/scripts/host/deploy-hephi.sh')
const evidenceFile = join(reviewRoot, 'evidence/pr20-independent/negative-tests.json')
const workRoot = mkdtempSync(join(reviewRoot, '.pr20-negative-'))
const requiredHealth = ['runtime', 'relay', 'notice', 'launch', 'delivery', 'assessment', 'reply', 'evals', 'models', 'github']
const results = []

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeout ?? 20_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveRun({ code: 1, out: `${out}${error.message}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code: code ?? 1, signal, out })
    })
  })
}

async function git(repo, args) {
  const result = await run('git', args, { cwd: repo })
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.out}`)
  return result.out.trim()
}

function pointer(instance) {
  try { return readlinkSync(join(instance, 'hephi/lib')) } catch { return '' }
}

function records(instance) {
  return readdirSync(join(instance, 'logs'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, data: JSON.parse(readFileSync(join(instance, 'logs', name), 'utf8')) }))
}

function makeRelease(releases, sha) {
  const dir = join(releases, sha)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  const entry = `export const commit = ${JSON.stringify(sha)}\n`
  writeFileSync(join(dir, 'lib/index.mjs'), entry)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    formatVersion: 1,
    pluginCommit: sha,
    sourceTree: sha,
    entrySha256: createHash('sha256').update(entry).digest('hex'),
    builtAt: '2026-11-07T00:00:00Z',
    buildCommand: 'independent fixture',
    hostVersion: 'host-1.0.0',
    source: 'git-archive',
  }, null, 2))
  return dir
}

async function makeFixture(name, libMode) {
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
  if (libMode === 'A' || libMode === 'B') {
    const sha = libMode === 'A' ? A : B
    symlinkSync(join(releases, sha, 'lib'), join(instance, 'hephi/lib'))
  } else if (libMode === 'directory') {
    mkdirSync(join(instance, 'hephi/lib'))
    writeFileSync(join(instance, 'hephi/lib/legacy.mjs'), '// legacy live directory\n')
  }
  return { root, instance, repo, releases, A, B }
}

async function withFakeHost(fixture, onState, body) {
  const state = {
    paused: true,
    health: 'ok',
    load: { running: 0, queued: 0, startupReservations: 0, effects: 0, jobs: 0, subagents: 0, unknown: 0 },
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (onState) onState(state, fixture)
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/orchestrator/api/state') {
      const health = Object.fromEntries(requiredHealth.map((name) => [name, {
        state: state.health === 'bad' && name === 'github' ? 'error' : 'ready',
        detail: state.health === 'bad' && name === 'github' ? 'injected failure' : 'ready',
        at: '2026-11-07T00:00:00Z',
      }]))
      res.end(JSON.stringify({ paused: state.paused, load: state.load, health }))
      return
    }
    if (url.pathname === '/orchestrator/api/tickets') {
      res.end('[]')
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await body(state, async (args, env = {}) => run('sh', [
      script,
      '--instance', fixture.instance,
      '--host', base,
      '--host-version', 'host-1.0.0',
      '--repo', fixture.repo,
      '--hephi', join(fixture.instance, 'hephi'),
      '--releases', fixture.releases,
      '--timeout', '1',
      ...args,
    ], { env }))
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

function reproduced(id, condition, evidence) {
  results.push({ id, reproduced: Boolean(condition), evidence })
  console.log(`${condition ? 'REPRODUCED' : 'NOT-REPRODUCED'} ${id}`)
}

try {
  // N1: migration from the actual legacy layout, a regular lib directory.
  {
    const fixture = await makeFixture('n1-regular-directory', 'directory')
    await withFakeHost(fixture, null, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.A])
      reproduced('N1 regular-directory migration fails at pointer rename',
        result.code !== 0 && lstatSync(join(fixture.instance, 'hephi/lib')).isDirectory() && /rename/i.test(result.out),
        { exitCode: result.code, output: result.out, libRemainsDirectory: lstatSync(join(fixture.instance, 'hephi/lib')).isDirectory() })
    })
  }

  // N2: rollback defaults an omitted target to repository HEAD before checking explicitness.
  {
    const fixture = await makeFixture('n2-rollback-implicit-target', 'A')
    await withFakeHost(fixture, null, async (_state, deploy) => {
      const result = await deploy(['--rollback', '--previous', fixture.A])
      const log = records(fixture.instance).find((entry) => entry.data.action === 'rollback')
      reproduced('N2 rollback without --target silently rolls to HEAD',
        result.code === 0 && pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib') && log?.data.result === 'ok',
        { exitCode: result.code, output: result.out, pointer: pointer(fixture.instance), record: log?.data })
    })
  }

  // N3: with no current pointer, rollback failure is still recorded and reported as restored.
  {
    const fixture = await makeFixture('n3-no-current-false-restoration', 'none')
    await withFakeHost(fixture, (state) => { state.health = 'bad' }, async (_state, deploy) => {
      const result = await deploy(['--rollback', '--target', fixture.B, '--previous', fixture.A])
      const log = records(fixture.instance).find((entry) => entry.data.action === 'rollback')
      reproduced('N3 failed rollback without current build claims previous restored',
        result.code !== 0 && log?.data.result === 'failed-restored-previous' && log?.data.previous === '' && /previous build restored/.test(result.out) && pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib'),
        { exitCode: result.code, output: result.out, pointer: pointer(fixture.instance), record: log?.data })
    })
  }

  // N4: inject a failure into the recovery rename itself, after the target switch.
  {
    const fixture = await makeFixture('n4-recovery-rename-failure', 'A')
    const marker = join(fixture.root, 'fail-recovery-rename')
    const bin = join(fixture.root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'node'), `#!/bin/sh\ncase "$*" in\n  *fs.renameSync*)\n    if [ -f "$FAIL_RENAME_MARKER" ]; then echo "injected recovery rename failure" >&2; exit 42; fi\n    ;;\nesac\nexec "$REAL_NODE" "$@"\n`)
    chmodSync(join(bin, 'node'), 0o755)
    await withFakeHost(fixture, (state) => {
      if (pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib')) {
        if (!existsSync(marker)) writeFileSync(marker, 'armed\n')
        state.health = 'bad'
      }
    }, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.B, '--previous', fixture.A], {
        PATH: `${bin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        FAIL_RENAME_MARKER: marker,
      })
      reproduced('N4 recovery rename failure bypasses double-failure recording',
        result.code === 42 && /injected recovery rename failure/.test(result.out) && records(fixture.instance).length === 0 && pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib'),
        { exitCode: result.code, output: result.out, pointer: pointer(fixture.instance), recordCount: records(fixture.instance).length })
    })
  }

  // N5: actual paused state changes to false after switching; the record still hardcodes true.
  {
    const fixture = await makeFixture('n5-paused-readback', 'A')
    let observedPausedAfterSwitch
    await withFakeHost(fixture, (state) => {
      if (pointer(fixture.instance) === join(fixture.releases, fixture.B, 'lib')) {
        state.paused = false
        observedPausedAfterSwitch = false
      }
    }, async (_state, deploy) => {
      const result = await deploy(['--target', fixture.B, '--previous', fixture.A])
      const log = records(fixture.instance).find((entry) => entry.data.action === 'deploy')
      reproduced('N5 success record hardcodes paused=true instead of readback',
        result.code === 0 && observedPausedAfterSwitch === false && log?.data.paused === true,
        { exitCode: result.code, output: result.out, observedPausedAfterSwitch, record: log?.data })
    })
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true })
}

const evidence = {
  schema: 1,
  reviewedCommit: '17d3827d3a73d3afb7a3b8de130d1615bd351769',
  script: 'scripts/host/deploy-hephi.sh',
  node: process.version,
  platform: process.platform,
  executedAt: new Date().toISOString(),
  note: 'REPRODUCED means the suspected defect was confirmed; it is not a product pass.',
  results,
}
mkdirSync(dirname(evidenceFile), { recursive: true })
writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`Evidence: ${evidenceFile}`)
if (results.some((result) => !result.reproduced)) process.exitCode = 1
