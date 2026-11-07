#!/usr/bin/env node
// Build the B7 preparation matrix (ROADMAP-95 §B7): every repository × model
// combination with its P10 build environment readiness, checks-config readiness,
// blockers and the fixed sample-size status. This is a preparation inventory
// only: it runs nothing, reads no host, and is NOT an experiment result.
//
//   node eval/b7-matrix.mjs --repos <repos.json> --models <models.json> \
//        (--out <matrix.json> | --dry-run)
//   node eval/b7-matrix.mjs --self-test
//
// repos.json (array, or `{ "repos": [...] }` with no extra fields; unknown
// fields inside an entry are rejected):
//   { "repoId": "dubbo", "language": "java", "stack": "maven",
//     "environmentReady": true, "checksConfig": true, "offlineBuild": true,
//     "notes": "optional" }
//   repoId: ^[a-z0-9][a-z0-9._-]{1,63}$ and unique
//   language: java | typescript | python (ROADMAP-95 §B7: Dubbo + one TS + one Python)
//   stack: optional non-empty string (maven / pnpm / pip ...)
//   environmentReady / checksConfig / offlineBuild: strict booleans; the three
//     P10 preparation facts (build environment, project checks config, offline
//     build verified)
//   notes: optional non-empty string
//
// models.json (array, or `{ "models": [...] }` with no extra fields):
//   { "modelId": "model-a", "provider": "provider-x", "notes": "optional" }
//   modelId: same id pattern, unique; provider: non-empty string; notes: optional
//
// Matrix rules (ROADMAP-95 §B7, P10, PREREG §6):
//   1. One row per repo × model, sorted by (repoId, modelId), so the same input
//      always yields the same matrix (generatedAt aside) and can be audited.
//   2. A row's `environmentReady` means P10 environment readiness INCLUDING the
//      offline-build check: repo.environmentReady && repo.offlineBuild.
//   3. `eligible` is true only when environmentReady && checksReady; every
//      missing precondition is named in `blockers` by its input field, so
//      `blockers` is empty exactly when `eligible` is true.
//   4. `sampleSizeStatus` is fixed to "pending-prereg": per repo/model sample
//      sizes must be locked in eval/PREREG.md §6 (D-4) before any run; this tool
//      never computes, guesses or invents sample sizes.
//   5. The B7 target is >= 3 repositories and >= 2 models (ROADMAP-95 §B7); the
//      output records whether the supplied inventory meets it and adds a note.
//   6. `preregLocked` is always false: this matrix is generated before PREREG is
//      locked and does not update PREREG.
//
// Exit codes: 0 success, 1 unexpected error, 2 usage/validation error.
// No dependencies, no network, no host access, no real runs.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MATRIX_SCHEMA_VERSION = 1
export const SAMPLE_SIZE_STATUS = 'pending-prereg'
export const PREREG_LOCKED = false
export const REPO_LANGUAGES = ['java', 'typescript', 'python']
export const B7_TARGETS = { minRepos: 3, minModels: 2 }

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
// Exact field sets: anything else in an entry is an unknown field and rejected.
const REPO_FIELDS = ['repoId', 'language', 'stack', 'environmentReady', 'checksConfig', 'offlineBuild', 'notes']
const MODEL_FIELDS = ['modelId', 'provider', 'notes']
// Blocker vocabulary (one blocker per failed input field; never invented states).
const BLOCKERS = ['environment-not-ready', 'offline-build-not-ready', 'checks-config-not-ready']

export class UsageError extends Error {}

function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function readList(input, key) {
  if (Array.isArray(input)) return input
  if (input && typeof input === 'object') {
    const keys = Object.keys(input)
    if (keys.length !== 1 || keys[0] !== key) {
      throw new UsageError(`${key} input must be an array or { "${key}": [...] } with no extra fields; got fields: ${keys.join(', ') || '(none)'}`)
    }
    return input[key]
  }
  throw new UsageError(`${key} input must be an array or { "${key}": [...] }`)
}

function requireSafeId(entry, field, label) {
  const value = entry[field]
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new UsageError(`${label}: ${field} must match ^[a-z0-9][a-z0-9._-]{1,63}$, got "${String(value)}"`)
  return value
}

function requireNonEmptyString(entry, field, label) {
  const value = entry[field]
  if (typeof value !== 'string' || !value.trim()) throw new UsageError(`${label}: ${field} must be a non-empty string`)
  return value.trim()
}

function requireBoolean(entry, field, label) {
  const value = entry[field]
  if (typeof value !== 'boolean') throw new UsageError(`${label}: ${field} must be a boolean (true/false)`)
  return value
}

function optionalString(entry, field, label) {
  const value = entry[field]
  if (value === undefined) return null
  if (typeof value !== 'string' || !value.trim()) throw new UsageError(`${label}: ${field} must be a non-empty string when present`)
  return value.trim()
}

function rejectUnknownFields(entry, allowed, label) {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) throw new UsageError(`${label}: unknown field "${key}"; allowed fields: ${allowed.join(', ')}`)
  }
}

/** Validate + normalize repositories (sorted by repoId, P10 flags echoed as given). */
export function validateRepos(input) {
  const raw = readList(input, 'repos')
  if (!Array.isArray(raw) || raw.length === 0) throw new UsageError('repos must be a non-empty array (or { "repos": [...] })')
  const repos = []
  const seen = new Set()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new UsageError('each repo must be an object with repoId/language/environmentReady/checksConfig/offlineBuild')
    const repoId = requireSafeId(entry, 'repoId', 'repo')
    const label = `repo ${repoId}`
    rejectUnknownFields(entry, REPO_FIELDS, label)
    if (seen.has(repoId)) throw new UsageError(`duplicate repoId: ${repoId}`)
    seen.add(repoId)
    if (!REPO_LANGUAGES.includes(entry.language)) throw new UsageError(`${label}: language must be one of ${REPO_LANGUAGES.join(', ')}, got "${String(entry.language)}"`)
    repos.push({
      repoId,
      language: entry.language,
      stack: optionalString(entry, 'stack', label),
      environmentReady: requireBoolean(entry, 'environmentReady', label),
      checksConfig: requireBoolean(entry, 'checksConfig', label),
      offlineBuild: requireBoolean(entry, 'offlineBuild', label),
      notes: optionalString(entry, 'notes', label),
    })
  }
  return repos.sort((a, b) => compareIds(a.repoId, b.repoId))
}

/** Validate + normalize models (sorted by modelId). */
export function validateModels(input) {
  const raw = readList(input, 'models')
  if (!Array.isArray(raw) || raw.length === 0) throw new UsageError('models must be a non-empty array (or { "models": [...] })')
  const models = []
  const seen = new Set()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new UsageError('each model must be an object with modelId/provider')
    const modelId = requireSafeId(entry, 'modelId', 'model')
    const label = `model ${modelId}`
    rejectUnknownFields(entry, MODEL_FIELDS, label)
    if (seen.has(modelId)) throw new UsageError(`duplicate modelId: ${modelId}`)
    seen.add(modelId)
    models.push({ modelId, provider: requireNonEmptyString(entry, 'provider', label), notes: optionalString(entry, 'notes', label) })
  }
  return models.sort((a, b) => compareIds(a.modelId, b.modelId))
}

/**
 * Build the preparation matrix. Pure function; `generatedAt` is injectable so
 * two runs over the same input can be compared byte-for-byte.
 */
export function buildMatrix({ repos, models, generatedAt = new Date().toISOString(), source = null }) {
  const sortedRepos = validateRepos(repos)
  const sortedModels = validateModels(models)
  const combos = []
  for (const repo of sortedRepos) {
    // P10 environment readiness includes the offline-build verification.
    const environmentReady = repo.environmentReady && repo.offlineBuild
    for (const model of sortedModels) {
      const blockers = []
      if (!repo.environmentReady) blockers.push('environment-not-ready')
      if (!repo.offlineBuild) blockers.push('offline-build-not-ready')
      if (!repo.checksConfig) blockers.push('checks-config-not-ready')
      combos.push({
        comboId: `b7-${repo.repoId}-${model.modelId}`,
        repo: repo.repoId,
        model: model.modelId,
        environmentReady,
        checksReady: repo.checksConfig,
        eligible: environmentReady && repo.checksConfig,
        blockers,
        sampleSizeStatus: SAMPLE_SIZE_STATUS,
      })
    }
  }
  const eligibleCombinations = combos.filter(combo => combo.eligible).length
  const totalCombinations = combos.length
  const reposMet = sortedRepos.length >= B7_TARGETS.minRepos
  const modelsMet = sortedModels.length >= B7_TARGETS.minModels
  const notes = [
    'This file is a B7 preparation matrix, not an experiment result: no run was executed, no host was accessed and no model was called.',
    `sampleSizeStatus is fixed to "${SAMPLE_SIZE_STATUS}": per repo/model sample sizes must be locked in eval/PREREG.md §6 (D-4) before any run. This tool does not compute or invent any sample size.`,
  ]
  if (!reposMet || !modelsMet) {
    notes.push(`B7 target not met: ROADMAP-95 §B7 requires >=${B7_TARGETS.minRepos} repositories and >=${B7_TARGETS.minModels} models; the supplied inventory has ${sortedRepos.length} repositories and ${sortedModels.length} models.`)
  }
  if (eligibleCombinations === 0) {
    notes.push('No eligible combination: at least one P10 environment or checks-config precondition is missing for every supplied repository.')
  }
  return {
    schemaVersion: MATRIX_SCHEMA_VERSION,
    generatedBy: 'eval/b7-matrix.mjs',
    generatedAt,
    preregLocked: PREREG_LOCKED,
    notes,
    ...(source === null ? {} : { source }),
    targets: { minRepos: B7_TARGETS.minRepos, minModels: B7_TARGETS.minModels, reposMet, modelsMet },
    totalCombinations,
    eligibleCombinations,
    blockedCombinations: totalCombinations - eligibleCombinations,
    repos: sortedRepos,
    models: sortedModels,
    combos,
  }
}

export function parseArgs(argv) {
  const options = { repos: null, models: null, out: null, dryRun: false, selfTest: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') { options.selfTest = true; continue }
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (!['--repos', '--models', '--out'].includes(arg)) throw new UsageError(`unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new UsageError(`missing value for ${arg}`)
    index += 1
    if (arg === '--repos') options.repos = value
    if (arg === '--models') options.models = value
    if (arg === '--out') options.out = value
  }
  if (options.selfTest || options.help) return options
  if (options.repos === null) throw new UsageError('--repos is required')
  if (options.models === null) throw new UsageError('--models is required')
  if (options.out === null && !options.dryRun) throw new UsageError('--out is required unless --dry-run is used')
  return options
}

export function readJsonFile(path, flag) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (error) {
    throw new UsageError(`cannot read ${flag} file ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try { return JSON.parse(text) } catch (error) {
    throw new UsageError(`${flag} file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Self-test: pure assertions plus real CLI executions on temporary fixtures.
// ---------------------------------------------------------------------------
function pass(list, name, condition, detail = '') {
  if (condition) { list.push(`PASS ${name}`); return }
  list.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}

function spawnCli(args) {
  const scriptPath = fileURLToPath(import.meta.url)
  const result = execFileSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { status: 0, stdout: result }
}

function spawnCliExpectFailure(args) {
  try {
    spawnCli(args)
    return { status: 0, stdout: '' }
  } catch (error) {
    const status = typeof error.status === 'number' ? error.status : null
    return { status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function stripGeneratedAt(matrix) { const copy = { ...matrix }; delete copy.generatedAt; return copy }

const FIXED_AT = '2026-11-07T00:00:00.000Z'
const READY_REPOS = [
  { repoId: 'dubbo', language: 'java', stack: 'maven', environmentReady: true, checksConfig: true, offlineBuild: true },
  { repoId: 'ts-project', language: 'typescript', stack: 'pnpm', environmentReady: true, checksConfig: true, offlineBuild: true },
  { repoId: 'py-project', language: 'python', stack: 'pip', environmentReady: true, checksConfig: true, offlineBuild: true },
]
const READY_MODELS = [
  { modelId: 'model-a', provider: 'provider-x' },
  { modelId: 'model-b', provider: 'provider-y' },
]

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function expectUsageError(list, name, fn, detail = '') {
  try {
    fn()
    pass(list, name, false, `no error thrown ${detail}`)
  } catch (error) {
    pass(list, name, error instanceof UsageError, `threw ${error instanceof Error ? error.constructor.name : typeof error}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function selfTest() {
  const results = []
  const root = mkdtempSync(join(tmpdir(), 'b7-matrix-self-'))
  const reposPath = join(root, 'repos.json')
  const modelsPath = join(root, 'models.json')
  writeFileSync(reposPath, JSON.stringify({ repos: READY_REPOS }, null, 2))
  writeFileSync(modelsPath, JSON.stringify({ models: READY_MODELS }, null, 2))
  try {
    // --- matrix semantics -------------------------------------------------
    const ready = buildMatrix({ repos: READY_REPOS, models: READY_MODELS, generatedAt: FIXED_AT })
    pass(results, 'self-test all-ready: 3 repos x 2 models = 6 combos', ready.totalCombinations === 6 && ready.combos.length === 6, `total=${ready.totalCombinations}`)
    pass(results, 'self-test all-ready: every combo is eligible', ready.eligibleCombinations === 6 && ready.blockedCombinations === 0 && ready.combos.every(combo => combo.eligible === true && combo.blockers.length === 0), JSON.stringify(ready.combos.map(combo => combo.eligible)))
    pass(results, 'self-test combo rows carry the required fields', ready.combos.every(combo => typeof combo.comboId === 'string' && typeof combo.repo === 'string' && typeof combo.model === 'string' && typeof combo.environmentReady === 'boolean' && typeof combo.checksReady === 'boolean' && typeof combo.eligible === 'boolean' && Array.isArray(combo.blockers) && combo.sampleSizeStatus === 'pending-prereg'))
    pass(results, 'self-test sampleSizeStatus is fixed to pending-prereg', ready.combos.every(combo => combo.sampleSizeStatus === SAMPLE_SIZE_STATUS))
    pass(results, 'self-test output is not an experiment result (preregLocked=false + notes)', ready.preregLocked === false && ready.schemaVersion === 1 && ready.notes.some(note => /not an experiment result/i.test(note)) && ready.notes.some(note => /pending-prereg/.test(note)), JSON.stringify(ready.notes))
    pass(results, 'self-test B7 target 3 repos / 2 models is met and recorded', ready.targets.reposMet === true && ready.targets.modelsMet === true && ready.notes.every(note => !/target not met/.test(note)))
    pass(results, 'self-test comboIds are unique and deterministic', new Set(ready.combos.map(combo => combo.comboId)).size === 6 && ready.combos.every(combo => combo.comboId === `b7-${combo.repo}-${combo.model}`))

    // Missing P10 environment.
    const noEnvRepos = clone(READY_REPOS).map(repo => repo.repoId === 'dubbo' ? { ...repo, environmentReady: false } : repo)
    const noEnv = buildMatrix({ repos: noEnvRepos, models: READY_MODELS, generatedAt: FIXED_AT })
    const noEnvRows = noEnv.combos.filter(combo => combo.repo === 'dubbo')
    pass(results, 'self-test missing environment: only that repo blocked', noEnvRows.length === 2 && noEnvRows.every(combo => combo.eligible === false && combo.blockers.includes('environment-not-ready')) && noEnv.eligibleCombinations === 4, JSON.stringify(noEnvRows))

    // Missing offline build belongs to P10 environment readiness.
    const noOfflineRepos = clone(READY_REPOS).map(repo => repo.repoId === 'py-project' ? { ...repo, offlineBuild: false } : repo)
    const noOffline = buildMatrix({ repos: noOfflineRepos, models: READY_MODELS, generatedAt: FIXED_AT })
    const noOfflineRows = noOffline.combos.filter(combo => combo.repo === 'py-project')
    pass(results, 'self-test missing offline build: environmentReady=false + blocker', noOfflineRows.length === 2 && noOfflineRows.every(combo => combo.environmentReady === false && combo.eligible === false && combo.blockers.includes('offline-build-not-ready')), JSON.stringify(noOfflineRows))

    // Missing checks config.
    const noChecksRepos = clone(READY_REPOS).map(repo => repo.repoId === 'ts-project' ? { ...repo, checksConfig: false } : repo)
    const noChecks = buildMatrix({ repos: noChecksRepos, models: READY_MODELS, generatedAt: FIXED_AT })
    const noChecksRows = noChecks.combos.filter(combo => combo.repo === 'ts-project')
    pass(results, 'self-test missing checks config: checksReady=false + blocker', noChecksRows.length === 2 && noChecksRows.every(combo => combo.checksReady === false && combo.eligible === false && combo.blockers.includes('checks-config-not-ready')) && noChecks.eligibleCombinations === 4, JSON.stringify(noChecksRows))

    pass(results, 'self-test blockers use only the documented vocabulary', ready.combos.concat(noEnv.combos, noOffline.combos, noChecks.combos).every(combo => combo.blockers.every(blocker => BLOCKERS.includes(blocker))))
    pass(results, 'self-test blockedCombinations = total - eligible', noEnv.blockedCombinations === 2 && noChecks.blockedCombinations === 2 && noOffline.blockedCombinations === 2)

    // Below B7 target: 2 repos must be flagged in notes.
    const belowTarget = buildMatrix({ repos: clone(READY_REPOS).filter(repo => repo.repoId !== 'py-project'), models: READY_MODELS, generatedAt: FIXED_AT })
    pass(results, 'self-test below-target inventory is flagged in notes', belowTarget.targets.reposMet === false && belowTarget.targets.modelsMet === true && belowTarget.notes.some(note => /target not met/.test(note)))

    // Stable ordering + deterministic output regardless of input order.
    const reversed = buildMatrix({ repos: [...READY_REPOS].reverse(), models: [...READY_MODELS].reverse(), generatedAt: FIXED_AT })
    pass(results, 'self-test input order does not change the matrix', JSON.stringify(ready) === JSON.stringify(reversed))
    const sortedPairs = ready.combos.map(combo => `${combo.repo}/${combo.model}`)
    pass(results, 'self-test combos sorted by (repo, model)', JSON.stringify(sortedPairs) === JSON.stringify([...sortedPairs].sort()))
    pass(results, 'self-test different generatedAt only changes generatedAt', JSON.stringify({ ...ready, generatedAt: 'x' }) === JSON.stringify({ ...buildMatrix({ repos: READY_REPOS, models: READY_MODELS, generatedAt: 'x' }), generatedAt: 'x' }))

    // --- validation -------------------------------------------------------
    expectUsageError(results, 'self-test rejects duplicate repoId', () => validateRepos([...READY_REPOS, clone(READY_REPOS[0])]))
    expectUsageError(results, 'self-test rejects duplicate modelId', () => validateModels([...READY_MODELS, clone(READY_MODELS[0])]))
    expectUsageError(results, 'self-test rejects empty repos', () => validateRepos([]))
    expectUsageError(results, 'self-test rejects empty models', () => validateModels({ models: [] }))
    expectUsageError(results, 'self-test rejects unknown repo field', () => validateRepos([{ ...clone(READY_REPOS[0]), extra: true }]))
    expectUsageError(results, 'self-test rejects unknown top-level repos field', () => validateRepos({ repos: [clone(READY_REPOS[0])], extra: 1 }))
    expectUsageError(results, 'self-test rejects invalid language enum', () => validateRepos([{ ...clone(READY_REPOS[0]), language: 'ruby' }]))
    expectUsageError(results, 'self-test rejects non-boolean environmentReady', () => validateRepos([{ ...clone(READY_REPOS[0]), environmentReady: 'yes' }]))
    expectUsageError(results, 'self-test rejects unknown model field', () => validateModels([{ ...clone(READY_MODELS[0]), extra: 1 }]))
    expectUsageError(results, 'self-test rejects invalid modelId', () => validateModels([{ modelId: 'Model A', provider: 'p' }]))

    // --- CLI executions on the temporary fixtures -------------------------
    const outA = join(root, 'matrix-a.json')
    const outB = join(root, 'matrix-b.json')
    spawnCli(['--repos', reposPath, '--models', modelsPath, '--out', outA])
    spawnCli(['--repos', reposPath, '--models', modelsPath, '--out', outB])
    const cliA = JSON.parse(readFileSync(outA, 'utf8'))
    const cliB = JSON.parse(readFileSync(outB, 'utf8'))
    pass(results, 'self-test CLI --out writes a parseable matrix with source paths', cliA.totalCombinations === 6 && cliA.eligibleCombinations === 6 && cliA.source.repos === reposPath && cliA.source.models === modelsPath && !Number.isNaN(Date.parse(cliA.generatedAt)))
    pass(results, 'self-test CLI is deterministic apart from generatedAt', JSON.stringify(stripGeneratedAt(cliA)) === JSON.stringify(stripGeneratedAt(cliB)))

    const dryOut = join(root, 'dry-out.json')
    // --out is passed on purpose: --dry-run must still print and write nothing.
    const dry = spawnCli(['--repos', reposPath, '--models', modelsPath, '--dry-run', '--out', dryOut])
    const dryMatrix = JSON.parse(dry.stdout)
    pass(results, 'self-test --dry-run prints the matrix and writes nothing', dryMatrix.totalCombinations === 6 && dryMatrix.schemaVersion === 1 && existsSync(dryOut) === false && dryMatrix.preregLocked === false)

    const failures = [
      ['unknown argument', ['--repos', reposPath, '--models', modelsPath, '--bogus', 'x']],
      ['missing --repos', ['--models', modelsPath, '--out', join(root, 'x.json')]],
      ['missing --out without --dry-run', ['--repos', reposPath, '--models', modelsPath]],
      ['unreadable repos file', ['--repos', join(root, 'missing.json'), '--models', modelsPath, '--out', join(root, 'x.json')]],
      ['duplicate repoId', ['--repos', (() => { const p = join(root, 'dup-repos.json'); writeFileSync(p, JSON.stringify([READY_REPOS[0], READY_REPOS[0]])); return p })(), '--models', modelsPath, '--out', join(root, 'x.json')]],
      ['unknown repo field', ['--repos', (() => { const p = join(root, 'extra-repos.json'); writeFileSync(p, JSON.stringify([{ ...READY_REPOS[0], extra: true }])); return p })(), '--models', modelsPath, '--out', join(root, 'x.json')]],
      ['empty models', ['--repos', reposPath, '--models', (() => { const p = join(root, 'empty-models.json'); writeFileSync(p, JSON.stringify([])); return p })(), '--out', join(root, 'x.json')]],
    ]
    for (const [label, args] of failures) {
      const result = spawnCliExpectFailure(args)
      pass(results, `self-test rejects invalid input: ${label} (exit 2)`, result.status === 2, `status=${result.status} ${result.stdout.slice(0, 300)}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  for (const line of results) console.log(line)
  const failed = results.filter(line => line.startsWith('FAIL')).length
  if (failed > 0) { console.log(`\nFAILED: ${failed} assertion(s)`); return 1 }
  console.log(`\nPASS: ${results.length} assertions (b7-matrix self-test)`)
  return 0
}

function usage() {
  return 'usage: node eval/b7-matrix.mjs --repos <repos.json> --models <models.json> (--out <matrix.json> | --dry-run)\n       node eval/b7-matrix.mjs --self-test'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    process.exitCode = 2
  }
  if (options && options.help) { console.log(usage()); process.exitCode = 0 }
  else if (options && options.selfTest) process.exitCode = selfTest()
  else if (options) {
    try {
      const matrix = buildMatrix({
        repos: readJsonFile(options.repos, '--repos'),
        models: readJsonFile(options.models, '--models'),
        source: { repos: options.repos, models: options.models },
      })
      const text = `${JSON.stringify(matrix, null, 2)}\n`
      if (options.dryRun) process.stdout.write(text)
      else writeFileSync(options.out, text)
      if (!options.dryRun) console.error(`matrix written: ${options.out} (${matrix.totalCombinations} combos, eligible=${matrix.eligibleCombinations}/${matrix.totalCombinations}, sampleSizeStatus=${SAMPLE_SIZE_STATUS})`)
    } catch (error) {
      const usageError = error instanceof UsageError
      console.error(error instanceof Error ? error.message : String(error))
      if (usageError) { console.error(usage()); process.exitCode = 2 } else process.exitCode = 1
    }
  }
}
