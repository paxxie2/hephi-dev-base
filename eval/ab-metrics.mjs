#!/usr/bin/env node
// Extract MECHANICAL diff metrics for A/B delivery runs. This script does not
// judge effectiveness: unrelated changes, objective changes, test weakening and
// all other effect conclusions belong to the B4 blind-review rubric and the B6
// statistics (eval/stats/report.py) computed from run.schema.json records.
//
// Deliberately removed (plan review P2/§B6): the format-only and rename
// estimates (`formatOnlyFiles`, `renames`), their `unrelatedRefactor` aggregate
// and `verdict.effective`. Those were heuristics, not measurements: formatting,
// rename and refactor classification cannot be decided mechanically, so the
// script must not emit them and must not produce an "effective" verdict.
//
//   node eval/ab-metrics.mjs eval/runs.json
//   node eval/ab-metrics.mjs --self-test
//
// T04: the same entry point also builds the task-level evaluation summary from
// the T04 run fields (`ticketIds`, `firstReviewCandidate`, `finalCandidate`,
// `acceptanceVerdict`, `mergedAt`, `sevenDayOutcome`, `queueWaitSeconds`,
// `reviewWaitSeconds`) and scores eight metrics against a fixed anchor table.
// See the T04 section below; no historical baseline is consulted.
//
// runs.json:
// {
//   "tasks": { "<taskId>": { "expectedFiles": ["glob", ...], "hiddenTest": "shell command run in the checkout" } },
//   "runs": [ { "task": "<taskId>", "arm": "off|native|staged", "repo": "/path/to/checkout", "base": "<sha>", "head": "<ref>",
//               "minutes": 12.5, "tokens": 180000, "readyDenials": 1, "humanDriftScore": 0 } ]
// }
//
// Mechanical fields per run: changed files/lines, outside-share, deleted tests,
// hidden-test pass (when configured), and the recorded cost/drift inputs.
// The checkout is left at its original HEAD; hidden tests run in a temporary worktree.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const TEST = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*Test.java', '**/*_test.go', '**/test_*.py']
const matches = (file, globs) => globs.some(glob => matchesGlob(file, glob))

/** Mechanical measurements only. No heuristic classification, no verdict. */
export function measure(run, task) {
  const range = [run.base, run.head]
  const files = git(run.repo, 'diff', '--name-only', '--no-renames', ...range).split('\n').filter(Boolean)
  const lines = new Map()
  for (const row of git(run.repo, 'diff', '--numstat', '--no-renames', ...range).split('\n').filter(Boolean)) {
    const [added, removed, file] = row.split('\t')
    lines.set(file, added === '-' ? 1 : Number(added) + Number(removed))
  }
  const deleted = git(run.repo, 'diff', '--name-only', '--no-renames', '--diff-filter=D', ...range).split('\n').filter(Boolean)
  const outside = files.filter(file => !matches(file, task.expectedFiles))
  const totalLines = [...lines.values()].reduce((a, b) => a + b, 0)
  const outsideLines = outside.reduce((sum, file) => sum + (lines.get(file) ?? 0), 0)
  let hiddenPass = null
  if (task.hiddenTest) {
    const tree = mkdtempSync(join(tmpdir(), 'ab-hidden-'))
    rmSync(tree, { recursive: true })
    git(run.repo, 'worktree', 'add', '--detach', tree, run.head)
    try {
      execFileSync('sh', ['-c', task.hiddenTest], { cwd: tree, stdio: 'ignore', timeout: 30 * 60 * 1000 })
      hiddenPass = true
    } catch { hiddenPass = false } finally { git(run.repo, 'worktree', 'remove', '--force', tree) }
  }
  return {
    task: run.task, arm: run.arm, files: files.length, lines: totalLines,
    outsideFiles: outside.length, outsideLines, outsideShare: totalLines ? outsideLines / totalLines : 0,
    deletedTests: deleted.filter(file => matches(file, TEST)).length,
    hiddenPass, minutes: run.minutes ?? null, tokens: run.tokens ?? null, readyDenials: run.readyDenials ?? null,
    humanDriftScore: run.humanDriftScore ?? null,
  }
}

const mean = values => { const v = values.filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

/** Per-arm means of the mechanical metrics. Effect tests are NOT computed here. */
export function summarize(rows) {
  const arms = {}
  for (const arm of [...new Set(rows.map(r => r.arm))]) {
    const r = rows.filter(row => row.arm === arm)
    arms[arm] = {
      runs: r.length,
      files: mean(r.map(x => x.files)),
      lines: mean(r.map(x => x.lines)),
      outsideFiles: mean(r.map(x => x.outsideFiles)),
      outsideLines: mean(r.map(x => x.outsideLines)),
      outsideShare: mean(r.map(x => x.outsideShare)),
      deletedTests: mean(r.map(x => x.deletedTests)),
      hiddenPassRate: mean(r.map(x => x.hiddenPass === null ? null : Number(x.hiddenPass))),
      humanDriftScore: mean(r.map(x => x.humanDriftScore)),
      minutes: mean(r.map(x => x.minutes)), tokens: mean(r.map(x => x.tokens)), readyDenials: mean(r.map(x => x.readyDenials)),
    }
  }
  return { arms }
}

// ---------------------------------------------------------------------------
// T04: structured evaluation collection + anchored scoring (AT-60 .. AT-64)
//
// Runs that share a taskId belong to the same task: their failures and costs are
// merged into one task aggregate first (AT-60), so one task delivered through
// several tickets is not counted several times.
//
// Eight metrics are scored against a fixed anchor table (AT-62). Anchors are the
// constants BELOW: no historical baseline and no per-batch reference data are
// read. 合格交付率 uses the task-defined anchors 86% => 100 and 60% => 0
// (linear between them).
//
// Missing values are never treated as zero: the metric becomes "unknown" and the
// total score is judged 不达标 (AT-61). When the observation window is shorter
// than 7 days or no merged PR is observable, no total score is produced and the
// rework rate is reported as 证据不足 (AT-64).
//
// Task-level aggregation rules:
//   * acceptance: failed beats passed; invalid only when neither passed nor
//     failed is known.
//   * merged: any ticket of the task merged => the task counts as merged.
//   * sevenDayOutcome: rework beats clean; pending / not-applicable are not
//     observable outcomes.
//   * costs (wall clock, tokens, queue/review waits): summed over the task's
//     tickets; the task value is null when any ticket of the task lacks it.
//   * first review pass: firstReviewCandidate.head === finalCandidate.head.
// Task-level costs / waits are aggregated across tasks by median.
// ---------------------------------------------------------------------------
export const OBSERVATION_DAYS_REQUIRED = 7

/** Fixed T04 anchors. direction=higher: full > zero; direction=lower: full < zero. */
export const METRIC_ANCHORS = Object.freeze({
  acceptanceRate: { direction: 'higher', zero: 0.60, full: 0.86, unit: 'ratio', label: '合格交付率' },
  mergeRate: { direction: 'higher', zero: 0.50, full: 0.90, unit: 'ratio', label: '合并率' },
  firstReviewPassRate: { direction: 'higher', zero: 0.40, full: 0.80, unit: 'ratio', label: '首审即终审率' },
  reworkRate: { direction: 'lower', zero: 0.30, full: 0.00, unit: 'ratio', label: '7 日返修率' },
  queueWaitSeconds: { direction: 'lower', zero: 1800, full: 60, unit: 'seconds', label: '队列等待（任务累计）' },
  reviewWaitSeconds: { direction: 'lower', zero: 7200, full: 300, unit: 'seconds', label: '审查等待（任务累计）' },
  wallClockSeconds: { direction: 'lower', zero: 2700, full: 300, unit: 'seconds', label: '任务耗时（任务累计）' },
  tokensTotal: { direction: 'lower', zero: 400000, full: 50000, unit: 'tokens', label: 'token 成本（任务累计）' },
})
export const METRIC_NAMES = Object.freeze(Object.keys(METRIC_ANCHORS))

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const round2 = value => Math.round(value * 100) / 100

/** Linear anchor score in 0..100, or null when the metric/value is unknown. */
export function anchorScore(name, value) {
  const anchor = METRIC_ANCHORS[name]
  const number = finite(value)
  if (!anchor || number === null) return null
  const span = anchor.direction === 'higher' ? anchor.full - anchor.zero : anchor.zero - anchor.full
  const raw = anchor.direction === 'higher' ? (number - anchor.zero) / span : (anchor.zero - number) / span
  return round2(Math.min(1, Math.max(0, raw)) * 100)
}

function median(values) {
  const numbers = values.map(finite).filter(value => value !== null).sort((a, b) => a - b)
  if (numbers.length === 0) return null
  const middle = Math.floor(numbers.length / 2)
  return numbers.length % 2 === 1 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2
}

const sumOrNull = values => (values.every(value => finite(value) !== null) ? values.reduce((a, b) => a + finite(b), 0) : null)

/** Merge the runs of one task into the task-level evaluation aggregate (AT-60). */
export function aggregateByTask(runs) {
  const groups = new Map()
  for (const run of runs) {
    const taskId = run.taskId ?? run.task
    if (typeof taskId !== 'string' || taskId === '') continue
    if (!groups.has(taskId)) groups.set(taskId, [])
    groups.get(taskId).push(run)
  }
  const tasks = []
  for (const [taskId, group] of groups) {
    const ticketIds = [...new Set(group.flatMap(run => Array.isArray(run.ticketIds) ? run.ticketIds : []))]
    const verdicts = group.map(run => run.acceptanceVerdict).filter(value => ['passed', 'failed', 'invalid'].includes(value))
    const acceptance = verdicts.includes('failed') ? 'failed' : verdicts.includes('passed') ? 'passed' : verdicts.includes('invalid') ? 'invalid' : null
    const readyRuns = group.filter(run => run.delivery === 'ready-pr-created')
    const merged = group.some(run => typeof run.mergedAt === 'string' && run.mergedAt !== '')
    const outcomes = group.map(run => run.sevenDayOutcome).filter(value => ['clean', 'rework'].includes(value))
    const sevenDayOutcome = outcomes.includes('rework') ? 'rework' : outcomes.includes('clean') ? 'clean' : null
    const candidates = group.filter(run => run.firstReviewCandidate?.head && run.finalCandidate?.head)
    tasks.push({
      taskId,
      runs: group.length,
      ticketIds,
      delivery: readyRuns.length === group.length ? 'ready-pr-created' : group.some(run => run.delivery === 'ready-pr-created') ? 'partially-delivered' : 'not-delivered',
      ready: readyRuns.length > 0,
      acceptance,
      merged,
      sevenDayOutcome,
      firstReviewPass: candidates.length === 0 ? null : candidates.every(run => run.firstReviewCandidate.head === run.finalCandidate.head),
      wallClockSeconds: sumOrNull(group.map(run => run.wallClockSeconds)),
      tokensTotal: sumOrNull(group.map(run => run.tokens?.total)),
      queueWaitSeconds: sumOrNull(group.map(run => run.queueWaitSeconds)),
      reviewWaitSeconds: sumOrNull(group.map(run => run.reviewWaitSeconds)),
      failures: group.filter(run => run.delivery !== 'ready-pr-created' || run.acceptanceVerdict === 'failed' || run.acceptanceVerdict === 'invalid').length,
    })
  }
  return { taskCount: tasks.length, ticketCount: tasks.reduce((sum, task) => sum + (task.ticketIds.length || task.runs), 0), tasks }
}

/**
 * Compute the eight T04 metrics, anchored scores and the total score from the
 * current batch only (AT-60/61/62/64). `now` is injectable for tests.
 */
export function computeMetrics(runs, { now = new Date() } = {}) {
  const aggregation = aggregateByTask(runs)
  const tasks = aggregation.tasks
  const reasons = []

  const ratio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : null)
  const values = {
    acceptanceRate: ratio(tasks.filter(task => task.acceptance === 'passed').length, tasks.filter(task => task.acceptance !== null).length),
    mergeRate: ratio(tasks.filter(task => task.merged).length, tasks.filter(task => task.ready).length),
    firstReviewPassRate: ratio(tasks.filter(task => task.firstReviewPass === true).length, tasks.filter(task => task.firstReviewPass !== null).length),
    reworkRate: ratio(tasks.filter(task => task.sevenDayOutcome === 'rework').length, tasks.filter(task => task.sevenDayOutcome !== null).length),
    queueWaitSeconds: median(tasks.map(task => task.queueWaitSeconds)),
    reviewWaitSeconds: median(tasks.map(task => task.reviewWaitSeconds)),
    wallClockSeconds: median(tasks.map(task => task.wallClockSeconds)),
    tokensTotal: median(tasks.map(task => task.tokensTotal)),
  }

  // AT-64: less than 7 observation days or no merged PR is observable => no total.
  const mergedTimes = runs.map(run => run.mergedAt).filter(value => typeof value === 'string' && value !== '').map(value => Date.parse(value)).filter(value => !Number.isNaN(value))
  const startedTimes = runs.map(run => run.startedAt).filter(value => typeof value === 'string' && value !== '').map(value => Date.parse(value)).filter(value => !Number.isNaN(value))
  const observationStart = mergedTimes.length ? Math.min(...mergedTimes) : startedTimes.length ? Math.min(...startedTimes) : null
  const endTime = now instanceof Date ? now.getTime() : Date.parse(now)
  const observedDays = observationStart === null || Number.isNaN(endTime) ? null : round2((endTime - observationStart) / 86400000)
  const insufficientObservation = observedDays === null || observedDays < OBSERVATION_DAYS_REQUIRED || mergedTimes.length === 0
  if (insufficientObservation) {
    reasons.push(
      mergedTimes.length === 0
        ? 'AT-64: no merged PR is observable, so the 7-day outcome cannot be observed'
        : `AT-64: observation window ${observedDays} day(s) < ${OBSERVATION_DAYS_REQUIRED} day(s)`,
    )
  }

  const metrics = METRIC_NAMES.map(name => {
    const anchor = METRIC_ANCHORS[name]
    const value = finite(values[name])
    const status = insufficientObservation && name === 'reworkRate' ? '证据不足' : value === null ? 'unknown' : 'ok'
    const score = status === 'ok' ? anchorScore(name, value) : null
    return { name, label: anchor.label, unit: anchor.unit, direction: anchor.direction, zero: anchor.zero, full: anchor.full, value: value === null ? null : round2(value), score, status }
  })
  const unknownMetrics = metrics.filter(metric => metric.status === 'unknown' && !(insufficientObservation && metric.name === 'reworkRate')).map(metric => metric.name)
  const observation = {
    requiredDays: OBSERVATION_DAYS_REQUIRED,
    observedDays,
    observedThrough: Number.isNaN(endTime) ? null : new Date(endTime).toISOString(),
    mergedTasks: mergedTimes.length,
    sufficient: !insufficientObservation,
  }
  if (insufficientObservation) {
    return { observation, aggregation, metrics, totalScore: null, verdict: '证据不足', reasons }
  }
  if (unknownMetrics.length > 0) {
    reasons.push(`AT-61: missing data for ${unknownMetrics.join(', ')}; the total is judged 不达标`)
    return { observation, aggregation, metrics, totalScore: null, verdict: '不达标', reasons }
  }
  const totalScore = round2(metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length)
  return { observation, aggregation, metrics, totalScore, verdict: 'scored', reasons }
}

/** True when the run carries any T04 collection field (so the CLI builds the T04 summary). */
function hasT04Fields(run) {
  return ['ticketIds', 'firstReviewCandidate', 'finalCandidate', 'acceptanceVerdict', 'mergedAt', 'sevenDayOutcome', 'queueWaitSeconds', 'reviewWaitSeconds']
    .some(field => field in run)
}

// ---------------------------------------------------------------------------
// Self-test: build a temporary git repository with a known diff and assert the
// mechanical measurements, plus assert the removed heuristic fields are gone.
// ---------------------------------------------------------------------------
function pass(list, name, condition, detail = '') {
  if (condition) { list.push(`PASS ${name}`); return }
  list.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}

function totalLines(row) { return row.lines }

export function selfTest() {
  const results = []
  const root = mkdtempSync(join(tmpdir(), 'ab-metrics-self-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const g = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  try {
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 'test@example.invalid')
    g('config', 'user.name', 'ab metrics self-test')
    mkdirSync(join(repo, 'src'))
    mkdirSync(join(repo, 'tests'))
    writeFileSync(join(repo, 'src/a.js'), 'export const a = 1\nexport const b = 2\n')
    writeFileSync(join(repo, 'src/b.js'), 'export const c = 3\n')
    writeFileSync(join(repo, 'tests/a.test.js'), ['test one', 'test two', 'test three'].join('\n') + '\n')
    writeFileSync(join(repo, 'README.md'), '# fixture\n')
    g('add', '.')
    g('commit', '-q', '-m', 'base')
    const base = g('rev-parse', 'HEAD').trim()
    // head: src/a.js +2/-1; add src/new.js (2 lines); delete tests/a.test.js (3 lines);
    // add docs/note.md (1 line, outside the allowed glob).
    writeFileSync(join(repo, 'src/a.js'), 'export const a = 10\nexport const b = 2\nexport const d = 4\n')
    writeFileSync(join(repo, 'src/new.js'), 'export const e = 5\nexport const f = 6\n')
    rmSync(join(repo, 'tests/a.test.js'))
    mkdirSync(join(repo, 'docs'))
    writeFileSync(join(repo, 'docs/note.md'), 'note\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'head')
    const head = g('rev-parse', 'HEAD').trim()

    const task = { expectedFiles: ['src/**'], hiddenTest: 'test -f src/new.js && test ! -e tests/a.test.js' }
    const row = measure({ task: 't1', arm: 'off', repo, base, head, minutes: 2, tokens: 100, readyDenials: 1, humanDriftScore: 0 }, task)
    pass(results, 'self-test changed file count', row.files === 4, `files=${row.files}`)
    pass(results, 'self-test changed line count', totalLines(row) === 9, `lines=${row.lines}`)
    pass(results, 'self-test outside files', row.outsideFiles === 2 && row.outsideLines === 4, `files=${row.outsideFiles} lines=${row.outsideLines}`)
    pass(results, 'self-test outside share', Math.abs(row.outsideShare - 4 / 9) < 1e-12, `share=${row.outsideShare}`)
    pass(results, 'self-test deleted test count', row.deletedTests === 1, `deletedTests=${row.deletedTests}`)
    pass(results, 'self-test hidden test result', row.hiddenPass === true, `hiddenPass=${row.hiddenPass}`)
    pass(results, 'self-test keeps recorded cost fields', row.minutes === 2 && row.tokens === 100 && row.readyDenials === 1 && row.humanDriftScore === 0)
    pass(results, 'self-test removed formatOnlyFiles/renames fields', !('formatOnlyFiles' in row) && !('renames' in row), Object.keys(row).join(','))
    const summary = summarize([row, { ...row, arm: 'native', files: 2, lines: 3, outsideFiles: 0, outsideLines: 0, outsideShare: 0 }])
    pass(results, 'self-test summarize has no unrelatedRefactor', !('unrelatedRefactor' in summary.arms.off), Object.keys(summary.arms.off).join(','))
    pass(results, 'self-test summarize has no effect verdict', !('verdict' in summary), Object.keys(summary).join(','))
    pass(results, 'self-test summarize keeps mechanical means', summary.arms.off.files === 4 && summary.arms.off.lines === 9 && summary.arms.native.files === 2 && summary.arms.native.lines === 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  // -------------------------------------------------------------------------
  // T04 self-test (AT-60 .. AT-64): pure, label-only fixtures. Expected scores
  // are hand-computed from the anchor table above; no git repository is needed.
  // -------------------------------------------------------------------------
  const shaA = 'a'.repeat(40)
  const shaB = 'b'.repeat(40)
  const shaC = 'c'.repeat(40)
  const ticket = (overrides) => ({
    taskId: 'task-alpha',
    ticketIds: ['ticket-1'],
    startedAt: '2026-01-01T00:00:00Z',
    delivery: 'ready-pr-created',
    acceptanceVerdict: 'passed',
    mergedAt: '2026-01-02T00:00:00Z',
    sevenDayOutcome: 'clean',
    firstReviewCandidate: { head: shaA, submittedAt: '2026-01-01T06:00:00Z' },
    finalCandidate: { head: shaA },
    queueWaitSeconds: 60,
    reviewWaitSeconds: 300,
    wallClockSeconds: 300,
    tokens: { total: 50000 },
    ...overrides,
  })
  const fixtureRuns = [
    ticket({ ticketIds: ['ticket-1'] }),
    ticket({ ticketIds: ['ticket-2'] }),
    ticket({
      taskId: 'task-beta',
      ticketIds: ['ticket-3'],
      delivery: 'blocked',
      acceptanceVerdict: 'failed',
      mergedAt: null,
      sevenDayOutcome: 'pending',
      firstReviewCandidate: { head: shaB, submittedAt: '2026-01-01T06:00:00Z' },
      finalCandidate: { head: shaC },
      queueWaitSeconds: 1800,
      reviewWaitSeconds: 7200,
      wallClockSeconds: 2700,
      tokens: { total: 400000 },
    }),
  ]
  const afterBatch = new Date('2026-03-01T00:00:00Z')

  // AT-60: same taskId + several tickets merge failures and costs.
  const agg = aggregateByTask(fixtureRuns)
  const alpha = agg.tasks.find(task => task.taskId === 'task-alpha')
  const beta = agg.tasks.find(task => task.taskId === 'task-beta')
  pass(results, 'T04 AT-60 aggregates by taskId (2 tasks / 3 tickets)', agg.taskCount === 2 && agg.ticketCount === 3, JSON.stringify({ taskCount: agg.taskCount, ticketCount: agg.ticketCount }))
  pass(results, 'T04 AT-60 merges ticket costs of one task', alpha?.wallClockSeconds === 600 && alpha?.tokensTotal === 100000 && alpha?.queueWaitSeconds === 120 && alpha?.reviewWaitSeconds === 600, JSON.stringify(alpha))
  pass(results, 'T04 AT-60 merges failures into the task outcome', alpha?.acceptance === 'passed' && alpha?.failures === 0 && beta?.acceptance === 'failed' && beta?.failures === 1, JSON.stringify({ alpha, beta }))

  // AT-62: fixed anchors, 合格交付率 86% => 100 and 60% => 0 (linear).
  pass(results, 'T04 AT-62 合格交付率 anchor 86% => 100', anchorScore('acceptanceRate', 0.86) === 100, String(anchorScore('acceptanceRate', 0.86)))
  pass(results, 'T04 AT-62 合格交付率 anchor 60% => 0', anchorScore('acceptanceRate', 0.60) === 0, String(anchorScore('acceptanceRate', 0.60)))
  pass(results, 'T04 AT-62 合格交付率 is linear between anchors', anchorScore('acceptanceRate', 0.73) === 50, String(anchorScore('acceptanceRate', 0.73)))
  const scored = computeMetrics(fixtureRuns, { now: afterBatch })
  const withBaseline = computeMetrics(fixtureRuns.map(run => ({ ...run, historicalBaseline: { acceptanceRate: 0.2, wallClockSeconds: 100000 } })), { now: afterBatch })
  pass(results, 'T04 AT-62 scores current values only (no historical baseline)', JSON.stringify(scored.metrics) === JSON.stringify(withBaseline.metrics) && scored.totalScore === withBaseline.totalScore && scored.verdict === withBaseline.verdict)

  // AT-63: hand-computed metric scores and eight metric names.
  const handMetrics = {
    acceptanceRate: { value: 0.5, score: 0.00 },
    mergeRate: { value: 1, score: 100.00 },
    firstReviewPassRate: { value: 0.5, score: 25.00 },
    reworkRate: { value: 0, score: 100.00 },
    queueWaitSeconds: { value: 960, score: 48.28 },
    reviewWaitSeconds: { value: 3900, score: 47.83 },
    wallClockSeconds: { value: 1650, score: 43.75 },
    tokensTotal: { value: 250000, score: 42.86 },
  }
  pass(results, 'T04 AT-63 eight metrics are computed in anchor order', JSON.stringify(scored.metrics.map(metric => metric.name)) === JSON.stringify(METRIC_NAMES), JSON.stringify(scored.metrics.map(metric => metric.name)))
  const metricsMatch = scored.metrics.every(metric => {
    const expected = handMetrics[metric.name]
    return expected !== undefined && metric.value === expected.value && metric.score === expected.score && metric.status === 'ok'
  })
  pass(results, 'T04 AT-63 hand-computed metric scores match the script', metricsMatch, JSON.stringify(scored.metrics.map(metric => [metric.name, metric.value, metric.score])))
  pass(results, 'T04 AT-63 hand-computed total score matches the script (50.97)', Math.abs(scored.totalScore - 50.97) <= 0.005 && scored.verdict === 'scored', `total=${scored.totalScore} verdict=${scored.verdict}`)
  pass(results, 'T04 AT-63 observation window is sufficient (58 days)', scored.observation.sufficient === true && scored.observation.observedDays >= 7 && scored.reasons.length === 0, JSON.stringify(scored.observation))

  // AT-61: missing data => metric unknown and the total is judged 不达标.
  const missingTokens = fixtureRuns.map(run => ({ ...run, tokens: { total: null } }))
  const missing = computeMetrics(missingTokens, { now: afterBatch })
  const tokensMetric = missing.metrics.find(metric => metric.name === 'tokensTotal')
  pass(results, 'T04 AT-61 missing data becomes unknown', tokensMetric?.status === 'unknown' && tokensMetric?.value === null && tokensMetric?.score === null, JSON.stringify(tokensMetric))
  pass(results, 'T04 AT-61 total is judged 不达标 without a score', missing.totalScore === null && missing.verdict === '不达标', `total=${missing.totalScore} verdict=${missing.verdict}`)
  pass(results, 'T04 AT-61 reasons name the unknown metric', missing.reasons.some(reason => reason.includes('tokensTotal')), JSON.stringify(missing.reasons))

  // AT-64: observation window shorter than 7 days, or no merged PR => no total.
  const shortWindow = computeMetrics(fixtureRuns, { now: new Date('2026-01-04T00:00:00Z') })
  const reworkShort = shortWindow.metrics.find(metric => metric.name === 'reworkRate')
  pass(results, 'T04 AT-64 short window produces no total score', shortWindow.totalScore === null && shortWindow.verdict === '证据不足', `total=${shortWindow.totalScore} verdict=${shortWindow.verdict}`)
  pass(results, 'T04 AT-64 short window marks rework as 证据不足', reworkShort?.status === '证据不足' && reworkShort?.score === null, JSON.stringify(reworkShort))
  const noMerge = fixtureRuns.map(run => ({ ...run, mergedAt: null, sevenDayOutcome: 'pending' }))
  const noMergeResult = computeMetrics(noMerge, { now: afterBatch })
  const reworkNoMerge = noMergeResult.metrics.find(metric => metric.name === 'reworkRate')
  pass(results, 'T04 AT-64 no observable PR produces no total score', noMergeResult.totalScore === null && noMergeResult.verdict === '证据不足' && noMergeResult.observation.mergedTasks === 0, `total=${noMergeResult.totalScore} verdict=${noMergeResult.verdict}`)
  pass(results, 'T04 AT-64 no observable PR marks rework as 证据不足', reworkNoMerge?.status === '证据不足', JSON.stringify(reworkNoMerge))

  for (const line of results) console.log(line)
  const failed = results.filter(line => line.startsWith('FAIL')).length
  if (failed > 0) { console.log(`\nFAILED: ${failed} assertion(s)`); return 1 }
  console.log(`\nPASS: ${results.length} assertions (ab-metrics self-test)`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--self-test') {
    process.exitCode = selfTest()
  } else if (!process.argv[2] || process.argv[2].startsWith('-')) {
    console.error('usage: node eval/ab-metrics.mjs <runs.json> | --self-test')
    process.exitCode = 2
  } else {
    try {
      const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
      const runs = Array.isArray(input.runs) ? input.runs : []
      const measurable = runs.length > 0 && runs.every(run => typeof run.repo === 'string' && typeof run.base === 'string' && typeof run.head === 'string')
      const output = {}
      if (measurable) {
        const rows = runs.map(run => measure(run, input.tasks?.[run.task] ?? input.tasks?.[run.taskId]))
        output.rows = rows
        Object.assign(output, summarize(rows))
      } else {
        output.rows = runs
      }
      if (runs.some(hasT04Fields)) {
        const summary = computeMetrics(runs)
        Object.assign(output, {
          observation: summary.observation,
          aggregation: summary.aggregation,
          metrics: summary.metrics,
          totalScore: summary.totalScore,
          verdict: summary.verdict,
        })
        if (summary.reasons.length > 0) output.reasons = summary.reasons
      }
      console.log(JSON.stringify(output, null, 2))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
