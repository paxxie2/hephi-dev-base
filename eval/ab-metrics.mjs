#!/usr/bin/env node
// Score A/B delivery runs from their Git results.
//
//   node eval/ab-metrics.mjs eval/runs.json
//
// runs.json:
// {
//   "tasks": { "<taskId>": { "expectedFiles": ["glob", ...], "hiddenTest": "shell command run in the checkout" } },
//   "runs": [ { "task": "<taskId>", "arm": "off|native|staged", "repo": "/path/to/checkout", "base": "<sha>", "head": "<ref>",
//               "minutes": 12.5, "tokens": 180000, "readyDenials": 1, "humanDriftScore": 0 } ]
// }
//
// The checkout is left at its original HEAD; hidden tests run in a temporary worktree.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const TEST = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*Test.java', '**/*_test.go', '**/test_*.py']
const matches = (file, globs) => globs.some(glob => matchesGlob(file, glob))

export function measure(run, task) {
  const range = [run.base, run.head]
  const files = git(run.repo, 'diff', '--name-only', '--no-renames', ...range).split('\n').filter(Boolean)
  const lines = new Map()
  for (const row of git(run.repo, 'diff', '--numstat', '--no-renames', ...range).split('\n').filter(Boolean)) {
    const [added, removed, file] = row.split('\t')
    lines.set(file, added === '-' ? 1 : Number(added) + Number(removed))
  }
  const deleted = git(run.repo, 'diff', '--name-only', '--no-renames', '--diff-filter=D', ...range).split('\n').filter(Boolean)
  const renames = git(run.repo, 'diff', '--name-status', '-M', ...range).split('\n').filter(row => /^[RC]/.test(row)).length
  const formatOnly = files.filter(file => !deleted.includes(file)
    && !git(run.repo, 'diff', '--no-renames', '-w', '--ignore-blank-lines', ...range, '--', file).trim())
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
    formatOnlyFiles: formatOnly.length, renames, deletedTests: deleted.filter(file => matches(file, TEST)).length,
    hiddenPass, minutes: run.minutes ?? null, tokens: run.tokens ?? null, readyDenials: run.readyDenials ?? null,
    humanDriftScore: run.humanDriftScore ?? null,
  }
}

const mean = values => { const v = values.filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

export function summarize(rows) {
  const arms = {}
  for (const arm of [...new Set(rows.map(r => r.arm))]) {
    const r = rows.filter(row => row.arm === arm)
    arms[arm] = {
      runs: r.length,
      outsideLines: mean(r.map(x => x.outsideLines)),
      outsideShare: mean(r.map(x => x.outsideShare)),
      unrelatedRefactor: mean(r.map(x => x.formatOnlyFiles + x.renames)),
      deletedTests: mean(r.map(x => x.deletedTests)),
      hiddenPassRate: mean(r.map(x => x.hiddenPass === null ? null : Number(x.hiddenPass))),
      humanDriftScore: mean(r.map(x => x.humanDriftScore)),
      minutes: mean(r.map(x => x.minutes)), tokens: mean(r.map(x => x.tokens)), readyDenials: mean(r.map(x => x.readyDenials)),
    }
  }
  const off = arms.off
  const verdict = {}
  for (const [arm, s] of Object.entries(arms)) {
    if (arm === 'off' || !off) continue
    const drop = (a, b) => (a === null || b === null || a === 0) ? null : (a - b) / a
    const outsideDrop = drop(off.outsideLines, s.outsideLines)
    const refactorDrop = drop(off.unrelatedRefactor, s.unrelatedRefactor)
    const completionHeld = off.hiddenPassRate === null || s.hiddenPassRate === null ? null : s.hiddenPassRate >= off.hiddenPassRate - 0.05
    verdict[arm] = {
      outsideLinesDrop: outsideDrop, unrelatedRefactorDrop: refactorDrop, completionHeld,
      effective: outsideDrop !== null && outsideDrop >= 0.3 && (refactorDrop === null || refactorDrop >= 0.3) && completionHeld === true,
    }
  }
  return { arms, verdict }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const rows = input.runs.map(run => measure(run, input.tasks[run.task]))
  console.log(JSON.stringify({ rows, ...summarize(rows) }, null, 2))
}
