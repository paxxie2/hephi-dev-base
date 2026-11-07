#!/usr/bin/env node
// ROADMAP-95 工作线 B / B2：任务集有效性校验器。
//
// 校验内容：
//   1) 结构：task.json / issue.md / hidden-test.sh / review.md / reference.patch 存在性与字段口径；
//   2) 有效性（完整模式，需要 git 仓库）：隐藏测试在 base 上失败、在参考修复上通过，各连续 3 次一致；
//   3) 范围：参考修复改动的文件必须落在 task.json.allowedFiles 内。
//
// 用法：
//   node eval/check-task.mjs <taskDir> --dry-run [--json]
//   node eval/check-task.mjs <taskDir> --repo <git仓库> [--base <sha|ref>] [--reference <patch>]
//                                       [--hidden-test <script>] [--repeats 3] [--json]
//   node eval/check-task.mjs --self-test [--json]
//
// 退出码：0=通过；1=任务无效；2=用法/环境缺失（例如没有 git 或缺少 --repo）。
// 本脚本只使用 Node 内置模块，不新增依赖；只在系统临时目录创建 worktree，不动主工作树。
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, matchesGlob, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA_VERSION = 1
const CATEGORIES = new Set([
  'defect-fix',
  'new-feature',
  'behavior-preserving-refactor',
  'cross-module',
  'staged-suitable',
])
const ISSUE_HEADINGS = ['## 任务', '## 验收', '## 合法范围']
const TASK_FIELDS_REQUIRED = [
  'schemaVersion', 'taskId', 'repo', 'base', 'category', 'referenceFix', 'allowedFiles',
  'issue', 'hiddenTest', 'review', 'stagedSuitable', 'contamination', 'checks',
]
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = `用法：
  node eval/check-task.mjs <taskDir> --dry-run [--json]
  node eval/check-task.mjs <taskDir> --repo <git仓库> [--base <sha|ref>] [--reference <patch>] [--hidden-test <script>] [--repeats 3] [--json]
  node eval/check-task.mjs --self-test [--json]

说明：
  --dry-run   只做结构/schema 校验，不访问 git（任务作者本地先跑）。
  完整模式    需要 --repo 或 task.json.repo 指向本机 git 仓库；校验 base 失败、参考修复通过、
              连续 --repeats 次一致、参考修复不越出 allowedFiles。
  退出码      0=通过；1=任务无效；2=用法/环境缺失。`

function usage(message) {
  console.error(`[check-task] ${message}\n\n${USAGE}`)
  process.exit(2)
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function sameIds(list) {
  return list.length > 0 && list.every((id) => id === list[0])
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function fileExists(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function gitOk() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function gitOrNull(cwd, args) {
  try {
    return git(cwd, args).trim()
  } catch {
    return null
  }
}

// ---- 结构校验 -------------------------------------------------------------

function strList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

export function validateStructure(taskDir) {
  const errors = []
  const warnings = []
  const dir = resolve(taskDir)
  const taskFile = join(dir, 'task.json')

  if (!existsSync(dir)) return { ok: false, errors: [`任务目录不存在：${dir}`], warnings, task: null }
  if (!fileExists(taskFile)) return { ok: false, errors: [`缺少 task.json：${taskFile}`], warnings, task: null }

  let task
  try {
    task = readJson(taskFile)
  } catch (error) {
    return { ok: false, errors: [`task.json 不是合法 JSON：${error.message}`], warnings, task: null }
  }

  const missing = TASK_FIELDS_REQUIRED.filter((field) => !(field in task))
  if (missing.length > 0) errors.push(`task.json 缺少字段：${missing.join(', ')}`)

  if (task.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion 必须为 ${SCHEMA_VERSION}`)
  if (typeof task.taskId !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(task.taskId)) {
    errors.push('taskId 必须匹配 ^[a-z0-9][a-z0-9._-]{1,63}$')
  }
  if (typeof task.repo !== 'string' || task.repo.length === 0) errors.push('repo 必须是非空字符串')
  if (task.base !== null && !(typeof task.base === 'string' && task.base.length > 0)) {
    errors.push('base 必须是完整 commit SHA（40 位）或 null（仅合成自测夹具）')
  } else if (typeof task.base === 'string' && !/^[0-9a-f]{40}$/.test(task.base)) {
    errors.push('base 不是 40 位小写十六进制 commit SHA')
  }
  if (!CATEGORIES.has(task.category)) errors.push(`category 必须是 ${[...CATEGORIES].join(' / ')}`)
  if (!strList(task.allowedFiles) || task.allowedFiles.length === 0) {
    errors.push('allowedFiles 必须是非空 glob 字符串数组')
  }
  if (typeof task.stagedSuitable !== 'boolean') errors.push('stagedSuitable 必须是 boolean')

  const contamination = task.contamination
  if (contamination === null || typeof contamination !== 'object') {
    errors.push('contamination 必须是对象')
  } else {
    if (typeof contamination.mergedAfterTrainingCutoff !== 'boolean') {
      errors.push('contamination.mergedAfterTrainingCutoff 必须是 boolean')
    }
    if (typeof contamination.private !== 'boolean') errors.push('contamination.private 必须是 boolean')
    if (contamination.mergedAfterTrainingCutoff === true && typeof contamination.cutoff !== 'string') {
      errors.push('contamination.mergedAfterTrainingCutoff=true 时 cutoff 必填')
    }
  }

  if (task.checks === null || typeof task.checks !== 'object') {
    errors.push('checks 必须是对象')
  } else {
    if (task.checks.baseMustFail !== true) errors.push('checks.baseMustFail 必须为 true')
    if (task.checks.referenceMustPass !== true) errors.push('checks.referenceMustPass 必须为 true')
  }

  const rel = (field, fallback) => (typeof task[field] === 'string' && task[field].length > 0 ? task[field] : fallback)
  const issuePath = resolve(dir, rel('issue', 'issue.md'))
  const hiddenPath = resolve(dir, rel('hiddenTest', 'hidden-test.sh'))
  const reviewPath = resolve(dir, rel('review', 'review.md'))
  const referencePath = resolve(dir, rel('referenceFix', 'reference.patch'))

  for (const [label, path] of [['issue', issuePath], ['hidden-test', hiddenPath], ['review', reviewPath], ['reference', referencePath]]) {
    if (!fileExists(path)) errors.push(`缺少 ${label} 文件：${path}`)
  }

  let issueText = ''
  if (fileExists(issuePath)) {
    issueText = readFileSync(issuePath, 'utf8')
    if (issueText.trim().length === 0) errors.push('issue.md 为空')
    for (const heading of ISSUE_HEADINGS) {
      if (!issueText.includes(heading)) errors.push(`issue.md 缺少二级标题：${heading}`)
    }
  }

  if (fileExists(hiddenPath)) {
    const hiddenText = readFileSync(hiddenPath, 'utf8')
    if (hiddenText.trim().length === 0) errors.push('hidden-test.sh 为空')
    if (!/^\s*#!\/(bin\/sh|usr\/bin\/env\s+(sh|bash))/m.test(hiddenText)) {
      warnings.push('hidden-test.sh 没有 sh/bash shebang；check-task 仍会用 sh 执行，但建议补上')
    }
    if (/\/(Users|home)\/[^/\s]+\//.test(hiddenText)) {
      warnings.push('hidden-test.sh 含绝对路径，可能不可移植（应当在 checkout 根目录相对执行）')
    }
  }

  if (fileExists(reviewPath)) {
    const reviewText = readFileSync(reviewPath, 'utf8')
    if (reviewText.trim().length < 40) errors.push('review.md 内容过短，必须写明合法范围判定理由')
    if (!reviewText.includes('合法范围')) warnings.push('review.md 未出现“合法范围”字样，请确认写法符合 eval/tasks/README.md')
  }

  if (fileExists(referencePath) && !readFileSync(referencePath, 'utf8').includes('diff --git')) {
    warnings.push('reference.patch 看起来不是 git 生成的 unified diff（缺少 diff --git 头）')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    task,
    files: { issuePath, hiddenPath, reviewPath, referencePath },
    taskFile,
    issueSha256: fileExists(issuePath) ? sha256(readFileSync(issuePath)) : null,
  }
}

// ---- 完整校验 -------------------------------------------------------------

function runHidden(worktree, hiddenPath, timeoutMs) {
  const result = spawnSync('sh', [hiddenPath], {
    cwd: worktree,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, TASK_CHECKOUT: worktree },
  })
  return {
    code: result.status,
    signal: result.signal ?? null,
    stdout: (result.stdout ?? '').slice(-2000),
    stderr: (result.stderr ?? '').slice(-2000),
    outputSha256: sha256(`${result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`),
  }
}

function repeatRuns(worktree, hiddenPath, repeats, timeoutMs) {
  return Array.from({ length: repeats }, () => runHidden(worktree, hiddenPath, timeoutMs))
}

function describeRuns(runs) {
  return runs.map((run) => run.code)
}

export function validateTask(options) {
  const taskDir = resolve(options.taskDir)
  const structure = validateStructure(taskDir)
  const report = {
    mode: 'full',
    taskDir,
    structure: { ok: structure.ok, errors: structure.errors, warnings: structure.warnings },
    checks: {},
    ok: false,
  }
  if (!structure.ok) return report

  const { task, files } = structure
  const repoArg = options.repo ?? (typeof task.repo === 'string' && isAbsolute(task.repo) ? task.repo : null)
  if (!repoArg) {
    return { ...report, ok: false, exitCode: 2, envError: '完整校验需要 --repo 指向本机 git 仓库（或 task.json.repo 写本机绝对路径）' }
  }
  if (!gitOk()) return { ...report, ok: false, exitCode: 2, envError: '找不到 git 可执行文件；无法做 base/参考修复校验' }

  const repoRoot = gitOrNull(repoArg, ['rev-parse', '--show-toplevel'])
  if (!repoRoot) return { ...report, ok: false, exitCode: 2, envError: `${repoArg} 不是 git 工作树/仓库` }

  const baseRef = options.base ?? task.base
  if (!baseRef) return { ...report, ok: false, exitCode: 2, envError: 'task.json.base 为 null；完整校验需要 --base <sha|ref>' }

  const baseSha = gitOrNull(repoRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  if (!baseSha) return { ...report, ok: false, exitCode: 1, error: `base 无法解析为 commit：${baseRef}` }

  const hiddenPath = resolve(options.hiddenTest ?? files.hiddenPath)
  const referencePath = resolve(options.reference ?? files.referencePath)
  if (!fileExists(hiddenPath)) return { ...report, ok: false, exitCode: 2, envError: `hidden-test 不存在：${hiddenPath}` }
  if (!fileExists(referencePath)) return { ...report, ok: false, exitCode: 2, envError: `reference patch 不存在：${referencePath}` }

  const repeats = Number(options.repeats ?? 3)
  if (!Number.isInteger(repeats) || repeats < 1) return { ...report, ok: false, exitCode: 2, envError: '--repeats 必须是正整数' }
  const timeoutMs = Number(options.timeoutMs ?? 30 * 60 * 1000)

  const tmpRoot = mkdtempSync(join(tmpdir(), 'hephi-b2-'))
  const worktree = join(tmpRoot, 'checkout')
  try {
    git(repoRoot, ['worktree', 'add', '--detach', '--quiet', worktree, baseSha])
  } catch (error) {
    rmSync(tmpRoot, { recursive: true, force: true })
    return { ...report, ok: false, exitCode: 1, error: `git worktree add 失败：${error.message.split('\n')[0]}` }
  }

  try {
    const baseRuns = repeatRuns(worktree, hiddenPath, repeats, timeoutMs)
    report.checks.base = {
      expected: 'fail',
      runs: baseRuns,
      codes: describeRuns(baseRuns),
      consistent: sameIds(baseRuns.map((run) => String(run.code))),
      ok: baseRuns.every((run) => run.code !== 0) && sameIds(baseRuns.map((run) => String(run.code))),
    }

    const untrackedBefore = new Set(
      git(worktree, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean),
    )
    let applyError = null
    try {
      git(worktree, ['apply', '--whitespace=nowarn', referencePath])
    } catch (error) {
      applyError = error.message.split('\n').slice(0, 3).join(' ')
    }

    if (applyError !== null) {
      report.checks.reference = { ok: false, error: `参考修复应用失败：${applyError}` }
    } else {
      // 参考修复可能新增文件（untracked，git diff 看不到），需与 patch 前快照比较。
      const untrackedAfter = git(worktree, ['ls-files', '--others', '--exclude-standard'])
        .split('\n')
        .filter(Boolean)
      const newUntracked = untrackedAfter.filter((file) => !untrackedBefore.has(file))
      const changedFiles = [
        ...new Set([
          ...git(worktree, ['diff', '--name-only', '--no-renames']).split('\n').filter(Boolean),
          ...newUntracked,
        ]),
      ]
      const outside = changedFiles.filter((file) => !task.allowedFiles.some((glob) => matchesGlob(file, glob)))
      report.checks.scope = {
        allowedFiles: task.allowedFiles,
        changedFiles,
        outside,
        ok: outside.length === 0,
      }
      const referenceRuns = repeatRuns(worktree, hiddenPath, repeats, timeoutMs)
      report.checks.reference = {
        expected: 'pass',
        runs: referenceRuns,
        codes: describeRuns(referenceRuns),
        consistent: sameIds(referenceRuns.map((run) => String(run.code))),
        ok: referenceRuns.every((run) => run.code === 0) && sameIds(referenceRuns.map((run) => String(run.code))),
      }
    }

    report.baseSha = baseSha
    report.repo = repoRoot
    report.repeats = repeats
    report.ok = Boolean(
      report.checks.base?.ok
      && report.checks.reference?.ok
      && report.checks.scope?.ok,
    )
    return report
  } finally {
    try { git(repoRoot, ['worktree', 'remove', '--force', worktree]) } catch { /* ignore */ }
    rmSync(tmpRoot, { recursive: true, force: true })
  }
}

// ---- 自测 -----------------------------------------------------------------

function selfTest(asJson) {
  const exampleDir = join(REPO_ROOT, 'eval', 'tasks', 'example')
  const steps = []
  const root = mkdtempSync(join(tmpdir(), 'hephi-b2-self-'))
  const repo = join(root, 'repo')
  const record = (name, ok, detail) => steps.push({ name, ok, detail })
  try {
    const dry = validateStructure(exampleDir)
    record('dry-run 结构校验（合成示例）', dry.ok, dry.ok ? 'ok' : dry.errors)

    cpSync(join(exampleDir, 'base'), repo, { recursive: true })
    git(repo, ['init', '--quiet'])
    git(repo, ['add', '-A'])
    git(repo, ['-c', 'user.name=B2 Self Test', '-c', 'user.email=b2@example.invalid', 'commit', '--quiet', '-m', 'synthetic base'])
    const baseSha = git(repo, ['rev-parse', 'HEAD']).trim()

    const pass = validateTask({
      taskDir: exampleDir,
      repo,
      base: baseSha,
      reference: join(exampleDir, 'reference.patch'),
      hiddenTest: join(exampleDir, 'hidden-test.sh'),
      repeats: 3,
    })
    record(
      '完整双向校验：base 失败 / 参考修复通过 / 3 次一致',
      pass.ok === true,
      pass.ok
        ? `base codes=${JSON.stringify(pass.checks.base.codes)} ref codes=${JSON.stringify(pass.checks.reference.codes)} scope=${JSON.stringify(pass.checks.scope.changedFiles)}`
        : JSON.stringify(pass.checks),
    )

    const alwaysPass = join(root, 'always-pass.sh')
    writeFileSync(alwaysPass, '#!/bin/sh\nexit 0\n', 'utf8')
    const badBase = validateTask({
      taskDir: exampleDir,
      repo,
      base: baseSha,
      reference: join(exampleDir, 'reference.patch'),
      hiddenTest: alwaysPass,
      repeats: 3,
    })
    record('负例：隐藏测试在 base 上通过 → 必须判任务无效', badBase.ok === false, JSON.stringify(badBase.checks.base?.codes ?? badBase.error))

    const outOfScope = join(root, 'out-of-scope.patch')
    writeFileSync(outOfScope, [
      'diff --git a/notes.txt b/notes.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/notes.txt',
      '@@ -0,0 +1 @@',
      '+out of scope',
      'diff --git a/src/calc.mjs b/src/calc.mjs',
      '--- a/src/calc.mjs',
      '+++ b/src/calc.mjs',
      '@@ -2,3 +2,3 @@',
      ' export function add(a, b) {',
      '-  return a - b',
      '+  return a + b',
      ' }',
      '',
    ].join('\n'), 'utf8')
    const badScope = validateTask({
      taskDir: exampleDir,
      repo,
      base: baseSha,
      reference: outOfScope,
      hiddenTest: join(exampleDir, 'hidden-test.sh'),
      repeats: 3,
    })
    record(
      '负例：参考修复越出 allowedFiles → 必须判任务无效',
      badScope.ok === false && (badScope.checks.scope?.outside ?? []).includes('notes.txt'),
      JSON.stringify(badScope.checks.scope ?? badScope.error),
    )

    const ok = steps.every((step) => step.ok)
    if (asJson) {
      console.log(JSON.stringify({ selfTest: ok, steps }, null, 2))
    } else {
      for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name} :: ${step.detail}`)
      console.log(ok ? 'SELF-TEST: PASS' : 'SELF-TEST: FAIL')
    }
    process.exit(ok ? 0 : 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ---- CLI ------------------------------------------------------------------

function printHuman(report) {
  const lines = []
  lines.push(`[check-task] mode=${report.mode} taskDir=${report.taskDir}`)
  if (report.mode === 'full') {
    if (report.repo) lines.push(`[check-task] repo=${report.repo} base=${report.baseSha} repeats=${report.repeats}`)
    const structureOk = report.structure?.ok
    lines.push(`${structureOk ? 'PASS' : 'FAIL'} structure :: ${structureOk ? 'ok' : (report.structure?.errors ?? []).join('; ')}`)
    for (const warning of report.structure?.warnings ?? []) lines.push(`WARN ${warning}`)
    if (report.checks.base) {
      lines.push(`${report.checks.base.ok ? 'PASS' : 'FAIL'} base-hidden-test :: codes=${JSON.stringify(report.checks.base.codes)} expected fail, consistent=${report.checks.base.consistent}`)
    }
    if (report.checks.scope) {
      lines.push(`${report.checks.scope.ok ? 'PASS' : 'FAIL'} allowed-scope :: changed=${JSON.stringify(report.checks.scope.changedFiles)} outside=${JSON.stringify(report.checks.scope.outside)}`)
    }
    if (report.checks.reference) {
      if (report.checks.reference.error) lines.push(`FAIL reference :: ${report.checks.reference.error}`)
      else lines.push(`${report.checks.reference.ok ? 'PASS' : 'FAIL'} reference-hidden-test :: codes=${JSON.stringify(report.checks.reference.codes)} expected pass, consistent=${report.checks.reference.consistent}`)
    }
    if (report.error) lines.push(`ERROR ${report.error}`)
    if (report.envError) lines.push(`ENV ${report.envError}`)
  } else {
    lines.push(`${report.ok ? 'PASS' : 'FAIL'} structure :: ${report.ok ? 'ok' : report.errors.join('; ')}`)
    for (const warning of report.warnings ?? []) lines.push(`WARN ${warning}`)
  }
  lines.push(`RESULT: ${report.ok ? 'PASS' : 'FAIL'}`)
  console.log(lines.join('\n'))
}

function main() {
  const asJson = hasFlag('json')
  if (hasFlag('self-test')) selfTest(asJson)

  const taskDir = process.argv[2]
  if (!taskDir || taskDir.startsWith('--')) usage('缺少 <taskDir>')
  const dryRun = hasFlag('dry-run')
  const report = dryRun
    ? { mode: 'dry-run', taskDir: resolve(taskDir), ...validateStructure(taskDir) }
    : validateTask({
        taskDir,
        repo: arg('repo'),
        base: arg('base'),
        reference: arg('reference'),
        hiddenTest: arg('hidden-test'),
        repeats: arg('repeats'),
        timeoutMs: arg('timeout-ms'),
      })

  if (asJson) console.log(JSON.stringify(report, null, 2))
  else printHuman(report)

  if (report.exitCode === 2) process.exit(2)
  process.exit(report.ok ? 0 : 1)
}

main()
