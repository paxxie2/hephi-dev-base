#!/usr/bin/env node
// B8 rework-CANDIDATE finder (ROADMAP-95 §B8).
//
// 只做机械候选发现：找出“合并后一定窗口内修改同一批文件、且引用了原 PR/Issue”的提交。
// 这些只是**候选**：返工率需要抽样人工分类（缺陷修复 / 需求变更 / 正常演进），
// 所以每条候选都带 `category: "pending-human"`，脚本不给出返工/非返工结论。
//
//   node eval/daily/rework.mjs --repo <dir> --since <date> --window-days <n> [--json]
//   node eval/daily/rework.mjs --self-test
//
// 口径（写入 eval/daily/MAINTENANCE.md）：
//   * “合并”= git 历史中的 merge commit（--merges）；引用 = commit message/body 中的
//     `#<n>` 或 `pull/<n>`；原 PR/Issue 引用取自 merge commit message。
//   * 后续提交 = merge..HEAD 范围内的非 merge commit，其 committer 时间落在
//     [mergeAt, mergeAt + windowDays) 内。
//   * 命中 = 后续提交 message 引用原编号 且 修改文件与 merge 引入文件有交集。
//   * 窗口长度由 PREREG 锁定（B8）；本工具只接受该值，不自行选择。
//   * 只读仓库（git log/show/diff），不写工作区、不访问网络。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export class UsageError extends Error {}
const DAY_MS = 24 * 60 * 60 * 1000

export function git(repo, args, env = {}) {
  return execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Extract referenced PR/Issue numbers from a commit message (`#42`, `pull/42`). */
export function extractRefs(text) {
  const refs = new Set()
  for (const match of String(text ?? '').matchAll(/(?:#(\d+))|(?:pull\/(\d+))/g)) {
    refs.add(Number(match[1] ?? match[2]))
  }
  return [...refs].sort((a, b) => a - b)
}

function splitLines(text) {
  return String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
}

function diffNames(repo, from, to) {
  return splitLines(git(repo, ['diff', '--name-only', '--no-renames', from, to]))
}

function commitFiles(repo, commit) {
  return splitLines(git(repo, ['show', '--name-only', '--format=', '--no-renames', commit]))
}

function commitMeta(repo, format, revision) {
  const [hash, committedAt, author, subject, ...body] = git(repo, ['show', '-s', `--format=${format}`, revision]).split('\0')
  return {
    commit: hash,
    committedAt,
    author,
    subject: subject ?? '',
    body: body.join('\0').replace(/\n+$/, ''),
  }
}

// Commit messages can contain newlines; use a record separator so git log output parses.
const LOG_FORMAT = '%H%x00%cI%x00%an%x00%s%x00%b%x1e'

function parseLogRows(text) {
  return String(text ?? '').split('\x1e').map(chunk => chunk.trim()).filter(Boolean).map(chunk => {
    const [hash, committedAt, author, subject, ...body] = chunk.split('\0')
    return { commit: hash, committedAt, author, subject: subject ?? '', body: body.join('\0'), at: Date.parse(committedAt) }
  })
}

/** Merge commits in `--since` range with their refs and introduced files. */
export function findMerges(repo, since) {
  const hashes = splitLines(git(repo, ['log', '--merges', `--since=${since}`, '--format=%H']))
  return hashes.map(hash => {
    const meta = commitMeta(repo, '%H%x00%cI%x00%an%x00%s%x00%b', hash)
    const files = diffNames(repo, `${hash}^1`, hash)
    const refs = extractRefs(`${meta.subject}\n${meta.body}`)
    return { mergeCommit: meta.commit, mergeAt: new Date(meta.committedAt).toISOString(), mergeSubject: meta.subject, mergeAuthor: meta.author, refs, files }
  })
}

/** Follow-up commits of one merge; only non-merge commits can be candidates. */
function followUps(repo, merge, windowDays) {
  const from = Date.parse(merge.mergeAt)
  const untilMs = from + windowDays * DAY_MS
  const until = new Date(untilMs).toISOString()
  const rows = parseLogRows(git(repo, [
    'log', '--no-merges', `${merge.mergeCommit}..HEAD`, `--since=${merge.mergeAt}`, `--until=${until}`,
    `--format=${LOG_FORMAT}`,
  ]))
  return rows.filter(row => Number.isFinite(row.at) && row.at >= from && row.at < untilMs)
}

/**
 * Find rework candidates. `windowDays` must be the PREREG-locked value.
 * Returns candidates with a `pending-human` category placeholder — never a verdict.
 */
export function findReworkCandidates(repo, { since, windowDays }) {
  const merges = findMerges(repo, since)
  const candidates = []
  for (const merge of merges) {
    if (merge.refs.length === 0 || merge.files.length === 0) continue
    for (const followUp of followUps(repo, merge, windowDays)) {
      const refs = extractRefs(`${followUp.subject}\n${followUp.body}`)
      const referenceMatches = refs.filter(number => merge.refs.includes(number))
      if (referenceMatches.length === 0) continue
      const files = commitFiles(repo, followUp.commit)
      const sharedFiles = files.filter(file => merge.files.includes(file))
      if (sharedFiles.length === 0) continue
      candidates.push({
        category: 'pending-human',
        original: { refs: merge.refs, mergeCommit: merge.mergeCommit, mergeAt: merge.mergeAt, mergeSubject: merge.mergeSubject },
        followUp: { commit: followUp.commit, committedAt: new Date(followUp.at).toISOString(), author: followUp.author, subject: followUp.subject },
        referenceMatches,
        sharedFiles,
      })
    }
  }
  return { repo, since, windowDays, mergesReviewed: merges.length, candidates, summary: { mergesReviewed: merges.length, candidates: candidates.length, pendingHuman: candidates.length } }
}

function pass(results, name, condition, detail = '') {
  if (condition) { results.push(`PASS ${name}`); return }
  results.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}

function spawnCli(args) {
  const scriptPath = fileURLToPath(import.meta.url)
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return { status: 0, stdout }
  } catch (error) {
    return { status: typeof error.status === 'number' ? error.status : null, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

export function selfTest() {
  const results = []
  const root = mkdtempSync(join(tmpdir(), 'daily-rework-self-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const run = (args, env = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } })
  const at = iso => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
  try {
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 'test@example.invalid'])
    run(['config', 'user.name', 'rework self-test'])
    writeFileSync(join(repo, 'base.txt'), 'base\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'base'], at('2020-01-01T00:00:00Z'))
    run(['checkout', '-q', '-b', 'feature'])
    writeFileSync(join(repo, 'shared.js'), 'export const shared = 1\n')
    writeFileSync(join(repo, 'feature.js'), 'export const feature = 1\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'feature: add shared module'], at('2020-01-02T00:00:00Z'))
    run(['checkout', '-q', 'main'])
    run(['merge', '--no-ff', '-m', 'Merge pull request #42 from feature', 'feature'], at('2020-01-03T00:00:00Z'))
    const hit = (file, message, iso) => {
      run(['checkout', '-q', '--', '.'])
      writeFileSync(join(repo, file), `${message}\n`)
      run(['add', '-A'])
      run(['commit', '-q', '-m', message], at(iso))
      return run(['rev-parse', 'HEAD']).trim()
    }
    const hitCommit = hit('shared.js', 'Fix regression from #42', '2020-01-05T00:00:00Z')
    hit('shared.js', 'Improve formatting of shared helpers', '2020-01-06T00:00:00Z')
    hit('other.js', 'Refs #42', '2020-01-06T12:00:00Z')
    hit('shared.js', 'Related to #77', '2020-01-07T00:00:00Z')
    hit('shared.js', 'Follow-up for #42', '2020-01-20T00:00:00Z')

    const result = findReworkCandidates(repo, { since: '2019-12-01T00:00:00Z', windowDays: 7 })
    pass(results, 'self-test finds exactly one rework candidate', result.candidates.length === 1 && result.summary.candidates === 1, JSON.stringify(result.summary))
    const candidate = result.candidates[0]
    pass(results, 'self-test candidate references the original PR', candidate && candidate.original.refs.includes(42) && candidate.referenceMatches.includes(42), candidate && JSON.stringify(candidate.referenceMatches))
    pass(results, 'self-test candidate points at the follow-up commit', candidate && candidate.followUp.commit === hitCommit && candidate.followUp.subject === 'Fix regression from #42', candidate && candidate.followUp.commit)
    pass(results, 'self-test candidate lists the shared files', candidate && JSON.stringify(candidate.sharedFiles) === JSON.stringify(['shared.js']), candidate && JSON.stringify(candidate.sharedFiles))
    pass(results, 'self-test candidate is pending-human, not a verdict', candidate && candidate.category === 'pending-human')
    pass(results, 'self-test ignores commits that modify a shared file without referencing the PR', !result.candidates.some(item => item.followUp.subject === 'Improve formatting of shared helpers'))
    pass(results, 'self-test ignores commits that reference the PR but touch other files', !result.candidates.some(item => item.followUp.subject === 'Refs #42'))
    pass(results, 'self-test ignores commits that reference another issue', !result.candidates.some(item => item.followUp.subject === 'Related to #77'))
    pass(results, 'self-test ignores commits outside the window', !result.candidates.some(item => item.followUp.subject === 'Follow-up for #42'))

    const longWindow = findReworkCandidates(repo, { since: '2019-12-01T00:00:00Z', windowDays: 30 })
    pass(results, 'self-test later reference enters only with a wider window', longWindow.candidates.some(item => item.followUp.subject === 'Follow-up for #42'))

    const jsonRun = spawnCli(['--repo', repo, '--since', '2019-12-01T00:00:00Z', '--window-days', '7', '--json'])
    const parsed = jsonRun.status === 0 ? JSON.parse(jsonRun.stdout) : null
    pass(results, 'self-test --json output is parseable and complete', parsed !== null && parsed.windowDays === 7 && parsed.summary.candidates === 1 && parsed.repo === repo)
    const humanRun = spawnCli(['--repo', repo, '--since', '2019-12-01T00:00:00Z', '--window-days', '7'])
    pass(results, 'self-test human output lists the candidate', humanRun.status === 0 && humanRun.stdout.includes('Fix regression from #42') && humanRun.stdout.includes('pending-human'))

    const badCases = [
      ['missing --repo', ['--since', '2019-12-01T00:00:00Z', '--window-days', '7']],
      ['missing --since', ['--repo', repo, '--window-days', '7']],
      ['missing --window-days', ['--repo', repo, '--since', '2019-12-01T00:00:00Z']],
      ['invalid --since', ['--repo', repo, '--since', 'not-a-date', '--window-days', '7']],
      ['invalid --window-days', ['--repo', repo, '--since', '2019-12-01T00:00:00Z', '--window-days', '0']],
      ['non-existent repo', ['--repo', join(root, 'missing'), '--since', '2019-12-01T00:00:00Z', '--window-days', '7']],
    ]
    for (const [label, args] of badCases) {
      pass(results, `self-test rejects invalid input: ${label} (exit 2)`, spawnCli(args).status === 2)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  for (const line of results) console.log(line)
  const failed = results.filter(line => line.startsWith('FAIL')).length
  if (failed > 0) { console.log(`\nFAILED: ${failed} assertion(s)`); return 1 }
  console.log(`\nPASS: ${results.length} assertions (rework self-test)`)
  return 0
}

function parseArgs(argv) {
  const options = { repo: null, since: null, windowDays: null, json: false, selfTest: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') { options.selfTest = true; continue }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (!['--repo', '--since', '--window-days'].includes(arg)) throw new UsageError(`unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new UsageError(`missing value for ${arg}`)
    index += 1
    if (arg === '--repo') options.repo = value
    if (arg === '--since') options.since = value
    if (arg === '--window-days') options.windowDays = value
  }
  if (options.selfTest || options.help) return options
  if (options.repo === null) throw new UsageError('--repo is required')
  if (options.since === null) throw new UsageError('--since is required')
  if (options.windowDays === null) throw new UsageError('--window-days is required')
  if (!existsSync(options.repo)) throw new UsageError(`--repo does not exist: ${options.repo}`)
  if (Number.isNaN(Date.parse(options.since))) throw new UsageError(`--since is not a valid date: ${options.since}`)
  if (!/^\d+$/.test(String(options.windowDays)) || Number(options.windowDays) <= 0) throw new UsageError(`--window-days must be a positive integer, got "${options.windowDays}"`)
  return { ...options, windowDays: Number(options.windowDays) }
}

function assertGitRepo(repo) {
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repo, stdio: 'ignore' }); return true } catch { return false }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('usage: node eval/daily/rework.mjs --repo <dir> --since <date> --window-days <n> [--json] | --self-test')
    process.exitCode = 2
  }
  if (options && options.help) { console.log('usage: node eval/daily/rework.mjs --repo <dir> --since <date> --window-days <n> [--json] | --self-test'); process.exitCode = 0 }
  else if (options && options.selfTest) process.exitCode = selfTest()
  else if (options) {
    try {
      if (!assertGitRepo(options.repo)) throw new UsageError(`--repo is not a git repository: ${options.repo}`)
      const result = findReworkCandidates(options.repo, { since: options.since, windowDays: options.windowDays })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(`rework candidates: ${result.candidates.length} (merges reviewed: ${result.summary.mergesReviewed}, window ${result.windowDays}d, since ${result.since})`)
        for (const candidate of result.candidates) {
          console.log(`- ${candidate.followUp.commit.slice(0, 10)} ${candidate.followUp.committedAt} "${candidate.followUp.subject}" refs=${candidate.referenceMatches.map(n => `#${n}`).join(',')} files=${candidate.sharedFiles.join(',')} <- merge ${candidate.original.mergeCommit.slice(0, 10)} category=${candidate.category}`)
        }
        console.log('note: candidates are pending-human classification (defect-fix / requirement-change / normal-evolution); this tool does not decide rework.')
      }
    } catch (error) {
      const usage = error instanceof UsageError
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = usage ? 2 : 1
    }
  }
}
