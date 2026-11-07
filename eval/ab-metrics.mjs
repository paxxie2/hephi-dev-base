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
      const rows = input.runs.map(run => measure(run, input.tasks[run.task]))
      console.log(JSON.stringify({ rows, ...summarize(rows) }, null, 2))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
