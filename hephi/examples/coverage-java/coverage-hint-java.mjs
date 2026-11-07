#!/usr/bin/env node
// C2 覆盖提示示例（Java/JaCoCo）：把「未被测试执行到的可执行改动」做成提示 JSON。
//
// 重要边界：
//   - 这是**项目侧示例脚本**，不是赫菲插件功能。赫菲不解析覆盖率；
//     本脚本输出只作为风险提示，默认不拦截，是否作为必需检查由项目决定。
//   - 只解析 JaCoCo XML 的 `line` 元素（行覆盖）；不解析分支/方法覆盖，不做语义判断。
//   - 示例使用 Node 内置模块与简单文本解析（不是完整 XML 解析器）；生产请用项目自己的工具。
//
// 用法：
//   node coverage-hint-java.mjs --report <jacoco.xml> --diff-file <change.diff> [--source-root src/main/java]
//   node coverage-hint-java.mjs --report <jacoco.xml> --repo . --base <commit> [--source-root src/main/java]
//   node coverage-hint-java.mjs --self-test
//
// 输出格式与 Node 示例一致，见 hephi/docs/project-config.md §5。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

const TOOL = { name: 'coverage-hint-java-example', version: '0.1.0' }
const USAGE = `usage: node coverage-hint-java.mjs --report <jacoco.xml> (--diff-file <unified.diff> | --repo <path> --base <commit>) [--source-root src/main/java] [--out <file>]
       node coverage-hint-java.mjs --self-test
       node coverage-hint-java.mjs --help

--report       JaCoCo XML 报告（含 <package>/<sourcefile>/<line nr mi ci>）。
--source-root  源码根目录（默认 src/main/java），与 JaCoCo 的 package name 拼接出仓库相对路径。
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
  console.error(`[coverage-hint-java] ${message}`)
  process.exit(code)
}

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

// 统一 diff → Map<相对路径, Set<新增/修改后的行号>>（与 Node 示例同一约定）
export function changedLinesFromDiff(diffText) {
  const changed = new Map()
  let current = null
  let newLine = 0
  for (const line of diffText.split('\n')) {
    const fileMatch = /^\+\+\+ (?:b\/)?(.+)$/.exec(line)
    if (fileMatch) {
      current = fileMatch[1].trim() === '/dev/null' ? null : normalizePath(fileMatch[1].trim())
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

function attribute(tag, name) {
  const match = new RegExp(`${name}="(-?\\d+)"`).exec(tag)
  return match === null ? null : Number(match[1])
}

// JaCoCo XML → Map<source-root 相对路径, {uncovered:Set<line>, executable:Set<line>}>
export function coverageFromJacoco(xml, sourceRoot = 'src/main/java') {
  const root = normalizePath(sourceRoot).replace(/\/+$/, '')
  const result = new Map()
  let packageName = ''
  let sourceFile = null
  for (const line of xml.split('\n')) {
    const packageMatch = /<package\s+name="([^"]*)"/.exec(line)
    if (packageMatch) {
      packageName = packageMatch[1]
      sourceFile = null
      continue
    }
    const sourceMatch = /<sourcefile\s+name="([^"]*)"/.exec(line)
    if (sourceMatch) {
      const parts = [root, packageName, sourceMatch[1]].filter(part => part !== '')
      sourceFile = normalizePath(parts.join('/'))
      result.set(sourceFile, { uncovered: new Set(), executable: new Set() })
      continue
    }
    if (sourceFile === null) continue
    const lineTag = /<line\s+([^/>]+)\/?>/.exec(line)
    if (!lineTag) continue
    const nr = attribute(lineTag[1], 'nr')
    const missed = attribute(lineTag[1], 'mi')
    const covered = attribute(lineTag[1], 'ci')
    if (nr === null || missed === null || covered === null) continue
    if (missed + covered <= 0) continue
    result.get(sourceFile).executable.add(nr)
    if (covered === 0) result.get(sourceFile).uncovered.add(nr)
  }
  return result
}

export function hint({ changed, coverage, baseSha = null, headSha = null }) {
  const uncovered = []
  for (const file of [...changed.keys()].sort()) {
    const lines = [...changed.get(file)].sort((a, b) => a - b)
    if (lines.length === 0) continue
    const entry = coverage.get(file)
    if (entry === undefined) {
      uncovered.push({ path: file, lines, reason: 'no coverage entry; executable status unknown' })
      continue
    }
    const missed = lines.filter(line => entry.uncovered.has(line))
    if (missed.length > 0) uncovered.push({ path: file, lines: missed, reason: 'line not covered by tests' })
  }
  return {
    schemaVersion: 1,
    kind: 'coverage-hint',
    tool: TOOL,
    generatedAt: new Date().toISOString(),
    baseSha,
    headSha,
    changedFiles: changed.size,
    uncovered,
    summary: {
      changedFiles: changed.size,
      uncoveredFiles: uncovered.length,
      uncoveredLines: uncovered.reduce((sum, item) => sum + item.lines.length, 0),
    },
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
  const xml = [
    '<report name="demo">',
    '  <package name="com/example">',
    '    <sourcefile name="Calc.java">',
    '      <line nr="3" mi="0" ci="2"/>',
    '      <line nr="4" mi="1" ci="0"/>',
    '      <line nr="5" mi="0" ci="0"/>',
    '    </sourcefile>',
    '  </package>',
    '</report>',
    '',
  ].join('\n')
  const diff = [
    'diff --git a/src/main/java/com/example/Calc.java b/src/main/java/com/example/Calc.java',
    '--- a/src/main/java/com/example/Calc.java',
    '+++ b/src/main/java/com/example/Calc.java',
    '@@ -2,0 +3,2 @@',
    '+int a = 1;',
    '+int b = 2;',
    'diff --git a/src/main/java/com/example/Other.java b/src/main/java/com/example/Other.java',
    '--- a/src/main/java/com/example/Other.java',
    '+++ b/src/main/java/com/example/Other.java',
    '@@ -0,0 +1,1 @@',
    '+class Other {}',
    '',
  ].join('\n')
  const coverage = coverageFromJacoco(xml)
  const changed = changedLinesFromDiff(diff)
  const calc = coverage.get('src/main/java/com/example/Calc.java')
  record('JaCoCo 解析：Calc.java 第 3 行覆盖、第 4 行未覆盖、第 5 行不可执行', calc?.uncovered.has(4) === true && calc?.uncovered.has(3) === false && calc?.executable.has(5) === false, JSON.stringify([...coverage].map(([file, entry]) => [file, [...entry.uncovered]])))
  const result = hint({ changed, coverage })
  const calcHint = result.uncovered.find(item => item.path.endsWith('Calc.java'))
  const otherHint = result.uncovered.find(item => item.path.endsWith('Other.java'))
  record('已知答案：Calc.java 只报第 4 行', calcHint?.lines.join(',') === '4', JSON.stringify(calcHint))
  record('已知答案：无报告条目的 Other.java 全部提示', otherHint?.lines.join(',') === '1' && otherHint.reason.includes('no coverage entry'), JSON.stringify(otherHint))
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

  const reportFile = arg('report')
  if (!reportFile) fail(2, '缺少 --report')
  if (!existsSync(reportFile)) fail(2, `报告文件不存在：${reportFile}`)
  let reportText
  try {
    reportText = readFileSync(reportFile, 'utf8')
  } catch (error) {
    fail(2, `无法读取报告文件：${error.message}`)
  }

  const repo = resolve(arg('repo', '.'))
  let diffText
  if (arg('diff-file')) {
    const file = arg('diff-file')
    if (!existsSync(file)) fail(2, `diff 文件不存在：${file}`)
    diffText = readFileSync(file, 'utf8')
  } else {
    const base = arg('base')
    if (!base) fail(2, '需要 --diff-file，或同时提供 --repo 与 --base')
    try {
      diffText = gitDiff(repo, base)
    } catch (error) {
      fail(2, `git diff 失败：${error.message}`)
    }
  }
  let headSha = null
  try {
    headSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch { /* 非 git 环境 */ }

  let coverage
  let changed
  try {
    coverage = coverageFromJacoco(reportText, arg('source-root', 'src/main/java'))
    changed = changedLinesFromDiff(diffText)
  } catch (error) {
    fail(1, `输入格式错误：${error.message}`)
  }
  const result = hint({ changed, coverage, baseSha: arg('base'), headSha })
  const output = `${JSON.stringify(result, null, 2)}\n`
  const out = arg('out')
  if (out) {
    writeFileSync(out, output, 'utf8')
    console.log(`[coverage-hint-java] 已写入 ${out}（uncoveredFiles=${result.summary.uncoveredFiles} lines=${result.summary.uncoveredLines}）`)
  } else {
    process.stdout.write(output)
  }
  console.log('[coverage-hint-java] 提示仅用于风险提示，不是通过/失败判定')
  return 0
}

process.exitCode = main()
