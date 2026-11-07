#!/usr/bin/env node
// C2 覆盖提示示例（Node）：把「未被测试执行到的可执行改动」做成提示 JSON。
//
// 重要边界：
//   - 这是**项目侧示例脚本**，不是赫菲插件功能。赫菲不解析覆盖率；
//     本脚本的输出只作为风险提示，默认不拦截，是否作为必需检查由项目决定。
//   - 「被执行到」不等于「有断言」，也不等于改动必要；无关重构也可能被完全覆盖。
//   - 只使用 Node 内置模块，不新增依赖。
//
// 用法：
//   node coverage-hint.mjs --coverage <coverage-final.json> --diff-file <change.diff>
//   node coverage-hint.mjs --coverage <coverage-final.json> --repo . --base <commit>
//   node coverage-hint.mjs --self-test
//
// 覆盖率输入：istanbul/nyc 的 coverage-final.json（statements 的 hit 计数）。
// diff 输入：统一 diff（建议 `git diff --unified=0 <base> --`）。
// 输出：见 README 与 hephi/docs/project-config.md §5 的格式约定。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, isAbsolute, relative, resolve } from 'node:path'

const TOOL = { name: 'coverage-hint-node-example', version: '0.1.0' }
const USAGE = `usage: node coverage-hint.mjs --coverage <coverage-final.json> (--diff-file <unified.diff> | --repo <path> --base <commit>) [--source-root <dir>] [--out <file>]
       node coverage-hint.mjs --self-test
       node coverage-hint.mjs --help

coverage-final.json: istanbul/nyc 的 statements 覆盖数据。diff 用 --diff-file 或 --repo+--base 取得。
--source-root  仅用于把绝对覆盖率路径映射为仓库相对路径（默认仓库根）。
输出 JSON：未被覆盖的可执行改动（只提示，不拦截）。`

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = process.argv[index + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}

function fail(code, message) {
  console.error(`[coverage-hint-node] ${message}`)
  process.exit(code)
}

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

function relativePath(file, repo) {
  const normalized = normalizePath(file)
  if (!isAbsolute(normalized)) return normalized
  const rel = normalizePath(relative(repo, normalized))
  return rel.startsWith('..') ? normalized : rel
}

// 统一 diff → Map<相对路径, Set<新增/修改后的行号>>
export function changedLinesFromDiff(diffText) {
  const changed = new Map()
  let current = null
  let newLine = 0
  for (const line of diffText.split('\n')) {
    const fileMatch = /^\+\+\+ (?:b\/)?(.+)$/.exec(line)
    if (fileMatch) {
      const file = fileMatch[1].trim()
      current = file === '/dev/null' ? null : normalizePath(file)
      if (current !== null && !changed.has(current)) changed.set(current, new Set())
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (current === null) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      changed.get(current).add(newLine)
      newLine += 1
    } else if (line.startsWith(' ')) {
      newLine += 1
    }
  }
  return changed
}

// istanbul coverage-final.json → Map<相对路径, {uncovered:Set<line>, executable:Set<line>}>
export function coverageFromIstanbul(text, repo = process.cwd()) {
  const data = JSON.parse(text)
  const result = new Map()
  for (const [rawFile, entry] of Object.entries(data)) {
    const file = relativePath(rawFile, repo)
    const executable = new Set()
    const uncovered = new Set()
    const statements = entry?.statementMap ?? {}
    const counts = entry?.s ?? {}
    for (const [id, statement] of Object.entries(statements)) {
      const start = statement?.start?.line
      const end = statement?.end?.line ?? start
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) continue
      for (let line = start; line <= end; line += 1) executable.add(line)
      if ((counts[id] ?? 0) === 0) {
        for (let line = start; line <= end; line += 1) uncovered.add(line)
      }
    }
    result.set(file, { executable, uncovered })
  }
  return result
}

const CODE_FILE = /\.(?:[cm]?js|jsx|tsx?|py|go|java|kt|rs)$/i
export function hint({ changed, coverage, baseSha = null, headSha = null }) {
  const uncovered = []
  for (const file of [...changed.keys()].sort()) {
    const lines = [...changed.get(file)].sort((a, b) => a - b)
    if (lines.length === 0) continue
    const entry = coverage.get(file)
    if (entry === undefined) {
      // 没有覆盖率条目的代码文件：无法判断可执行性，整段按提示处理。
      // 非代码文件（README/配置等）不进入覆盖率提示，避免噪声。
      if (!CODE_FILE.test(file)) continue
      uncovered.push({ path: file, lines, reason: 'no coverage entry; executable status unknown' })
      continue
    }
    const missed = lines.filter(line => entry.uncovered.has(line))
    if (missed.length > 0) uncovered.push({ path: file, lines: missed, reason: 'statement not executed by tests' })
  }
  const uncoveredFiles = uncovered.length
  const uncoveredLines = uncovered.reduce((sum, item) => sum + item.lines.length, 0)
  return {
    schemaVersion: 1,
    kind: 'coverage-hint',
    tool: TOOL,
    generatedAt: new Date().toISOString(),
    baseSha,
    headSha,
    changedFiles: changed.size,
    uncovered,
    summary: { changedFiles: changed.size, uncoveredFiles, uncoveredLines },
  }
}

function gitDiff(repo, base) {
  return execFileSync('git', ['-C', repo, 'diff', '--unified=0', '--no-color', '--no-ext-diff', base, '--'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  })
}

function runSelfTest() {
  const steps = []
  const record = (name, ok, detail) => steps.push({ name, ok: Boolean(ok), detail })
  const diff = [
    'diff --git a/src/a.mjs b/src/a.mjs',
    '--- a/src/a.mjs',
    '+++ b/src/a.mjs',
    '@@ -2,0 +3,2 @@',
    '+line 3',
    '+line 4',
    'diff --git a/src/b.mjs b/src/b.mjs',
    '--- a/src/b.mjs',
    '+++ b/src/b.mjs',
    '@@ -1,0 +2,1 @@',
    '+line 2',
    'diff --git a/src/c.mjs b/src/c.mjs',
    '--- a/src/c.mjs',
    '+++ b/src/c.mjs',
    '@@ -4,0 +5,1 @@',
    '+line 5',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -0,0 +1,1 @@',
    '+docs only',
    '',
  ].join('\n')
  const coverage = {
    'src/a.mjs': {
      statementMap: { 0: { start: { line: 3 }, end: { line: 3 } }, 1: { start: { line: 4 }, end: { line: 4 } } },
      s: { 0: 2, 1: 0 },
    },
    'src/c.mjs': {
      statementMap: { 0: { start: { line: 5 }, end: { line: 5 } } },
      s: { 0: 1 },
    },
  }
  const changed = changedLinesFromDiff(diff)
  record('diff 解析：4 个文件、a.mjs 新增第 3/4 行', changed.size === 4 && changed.get('src/a.mjs')?.has(3) && changed.get('src/a.mjs')?.has(4), JSON.stringify([...changed].map(([file, lines]) => [file, [...lines]])))
  record('覆盖率解析：a.mjs 第 3 行已覆盖、第 4 行未覆盖', coverageFromIstanbul(JSON.stringify(coverage)).get('src/a.mjs')?.uncovered.has(4) === true && coverageFromIstanbul(JSON.stringify(coverage)).get('src/a.mjs')?.uncovered.has(3) === false, 'ok')
  const result = hint({ changed, coverage: coverageFromIstanbul(JSON.stringify(coverage)) })
  const a = result.uncovered.find(item => item.path === 'src/a.mjs')
  const b = result.uncovered.find(item => item.path === 'src/b.mjs')
  const c = result.uncovered.find(item => item.path === 'src/c.mjs')
  record('已知答案：a.mjs 只报第 4 行', a?.lines.length === 1 && a.lines[0] === 4, JSON.stringify(a))
  record('已知答案：无覆盖率条目的 b.mjs 全部改动都提示', b?.lines.join(',') === '2' && b.reason.includes('no coverage entry'), JSON.stringify(b))
  record('已知答案：已覆盖的 c.mjs 不提示', c === undefined, JSON.stringify(c))
  record('已知答案：summary 计数', result.summary.uncoveredFiles === 2 && result.summary.uncoveredLines === 2, JSON.stringify(result.summary))
  const ok = steps.every(step => step.ok)
  for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name} :: ${step.detail}`)
  console.log(ok ? 'SELF-TEST: PASS' : 'SELF-TEST: FAIL')
  return ok ? 0 : 1
}

function main() {
  if (hasFlag('help')) {
    console.log(USAGE)
    return 0
  }
  if (hasFlag('self-test')) return runSelfTest()

  const coverageFile = arg('coverage')
  if (!coverageFile) fail(2, '缺少 --coverage')
  if (!existsSync(coverageFile)) fail(2, `coverage 文件不存在：${coverageFile}`)
  let coverageText
  try {
    coverageText = readFileSync(coverageFile, 'utf8')
  } catch (error) {
    fail(2, `无法读取 coverage 文件：${error.message}`)
  }

  const repo = resolve(arg('repo', '.'))
  let diffText
  let baseSha = arg('base')
  if (arg('diff-file')) {
    const file = arg('diff-file')
    if (!existsSync(file)) fail(2, `diff 文件不存在：${file}`)
    try {
      diffText = readFileSync(file, 'utf8')
    } catch (error) {
      fail(2, `无法读取 diff 文件：${error.message}`)
    }
  } else {
    if (!baseSha) fail(2, '需要 --diff-file，或同时提供 --repo 与 --base')
    try {
      diffText = gitDiff(repo, baseSha)
    } catch (error) {
      fail(2, `git diff 失败：${error.message}`)
    }
  }
  let headSha = null
  try {
    headSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch { /* 非 git 环境只保留 base */ }

  let coverage
  let changed
  try {
    coverage = coverageFromIstanbul(coverageText, repo)
    changed = changedLinesFromDiff(diffText)
  } catch (error) {
    fail(1, `输入格式错误：${error.message}`)
  }
  const report = hint({ changed, coverage, baseSha, headSha })
  const output = `${JSON.stringify(report, null, 2)}\n`
  const out = arg('out')
  if (out) {
    writeFileSync(out, output, 'utf8')
    console.log(`[coverage-hint-node] 已写入 ${out}（uncoveredFiles=${report.summary.uncoveredFiles} lines=${report.summary.uncoveredLines}）`)
  } else {
    process.stdout.write(output)
  }
  console.log('[coverage-hint-node] 提示仅用于风险提示，不是通过/失败判定')
  return 0
}

process.exitCode = main()
