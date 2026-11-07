#!/usr/bin/env node
// ROADMAP-95 §3.2 S1：候选构建自测预检（可执行）。
//
// 重要：本仓库工作树就是宿主实载插件目录，**禁止在工作树里运行 pnpm build/check**。
// 本脚本只在 mkdtemp 临时克隆里构建与测试；默认清理临时目录（--keep 保留用于排查）。
//
// 用法：
//   node scripts/release/preflight.mjs [--source <repo>] [--ref <ref>] [--out <file>]
//                                        [--skip-check] [--dry-run] [--keep]
//   node scripts/release/preflight.mjs --help
//
// 步骤（S1 候选自测）：
//   1. 校验 source 是 git 仓库、工作树干净、ref 可解析（非 40hex ref 时要求 source HEAD == ref）；
//   2. 在 mkdtemp 克隆 `git clone --no-hardlinks <source>` 并 checkout ref，确认克隆树干净；
//   3. （除非 --skip-check）在克隆的 `hephi/` 运行 `pnpm install --frozen-lockfile` + `pnpm check`；
//   4. 在克隆根运行假宿主套件 `node scripts/host/test-deploy-hephi.mjs` 与
//      `node scripts/host/test-effects-db.mjs`；
//   5. 输出 JSON 报告（--out 或 stdout）并打印摘要；任一步失败 → exit 1。
//
// 退出码：0=全部 PASS / dry-run 计划成功；1=预检步骤失败（含 source 脏、HEAD 不匹配）；2=用法/环境错误。
//
// 限制：脚本无法通用识别“source 是实载插件目录”；运行前请确认 source 是普通仓库克隆/worktree。
//       预检 PASS 不等于真实部署（S3）或真实验收（S4）通过。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const USAGE = `usage: node scripts/release/preflight.mjs [--source <repo>] [--ref <ref>] [--out <file>] [--skip-check] [--dry-run] [--keep]

S1 候选构建自测（在 mkdtemp 临时克隆中运行 pnpm install/check 与假宿主套件；不在工作树构建）。

选项：
  --source <repo>   源仓库路径（默认：本脚本所在仓库根）
  --ref <ref>       候选 ref（默认 HEAD；分支/tag/40hex SHA 均可）
  --out <file>      JSON 报告输出路径（默认打印到 stdout 摘要 + JSON）
  --skip-check      跳过 pnpm install --frozen-lockfile 与 pnpm check（假宿主套件仍运行）
  --dry-run         只打印将执行的步骤与克隆计划，不 clone、不运行 check
  --keep            保留临时克隆目录（失败时用于排查；成功时打印路径）
  --help            显示本帮助

前置：
  - PATH 中要有 node 与 pnpm；pnpm check 口径为 Node v22.19.0（本脚本只记录实际版本，不强制）。
  - source 必须是普通 git 仓库/克隆且工作树干净；**不要把宿主实载插件目录当 source**。
  - 本脚本不做真实部署、不连宿主、不推分支；S1 PASS 不等于 S2/S3/S4 通过。

退出码：0=PASS/dry-run；1=预检失败；2=用法/环境错误。`

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
  console.error(`[preflight] ${message}`)
  process.exit(code)
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

function toolVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0 || result.error) return null
  return (result.stdout ?? result.stderr ?? '').trim().split('\n')[0] ?? null
}

function step(name, command, args, cwd, timeoutMs) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  })
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1))
  const tailText = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  const tail = tailText.length > 4000 ? tailText.slice(-4000) : tailText
  const exit = result.error ? null : result.status
  return {
    name, command: [command, ...args].join(' '), cwd,
    exit, seconds, tail,
    ...(result.error ? { error: result.error.message } : {}),
    ...(result.signal ? { signal: result.signal } : {}),
  }
}

function skippedStep(name, command, cwd, reason) {
  return { name, command, cwd, exit: null, seconds: 0, tail: '', skipped: true, reason }
}

function parseArgs() {
  const allowedValue = new Set(['--source', '--ref', '--out'])
  const allowedFlag = new Set(['--skip-check', '--dry-run', '--keep', '--help', '-h'])
  for (let index = 2; index < process.argv.length; index += 1) {
    const current = process.argv[index]
    if (allowedFlag.has(current)) continue
    if (allowedValue.has(current)) { index += 1; continue }
    fail(2, `unknown argument: ${current}\n\n${USAGE}`)
  }
  return {
    source: arg('source', SCRIPT_ROOT),
    ref: arg('ref', 'HEAD'),
    out: arg('out'),
    skipCheck: hasFlag('skip-check'),
    dryRun: hasFlag('dry-run'),
    keep: hasFlag('keep'),
  }
}

function main() {
  if (hasFlag('help') || process.argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  const options = parseArgs()
  const source = resolve(options.source)
  if (!existsSync(source)) fail(2, `source 不存在：${source}`)
  const top = git(source, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) fail(2, `source 不是 git 仓库：${source}`)
  const repoRoot = resolve(top.stdout)
  const status = git(repoRoot, ['status', '--porcelain'])
  if (status.status !== 0) fail(2, `无法读取 source 工作树状态：${status.stderr}`)
  const treeClean = status.stdout === ''
  const headSha = git(repoRoot, ['rev-parse', 'HEAD']).stdout || null
  const refCommitResult = git(repoRoot, ['rev-parse', '--verify', `${options.ref}^{commit}`])
  if (refCommitResult.status !== 0) fail(2, `ref 无法解析为 commit：${options.ref}`)
  const refSha = refCommitResult.stdout
  const refIsSha = /^[0-9a-f]{40}$/.test(options.ref)
  const headMatchesRef = headSha === refSha
  const nodeVersion = toolVersion('node')
  const pnpmVersion = toolVersion('pnpm')

  const plan = {
    clone: `git clone --no-hardlinks ${repoRoot} <tmp>/repo`,
    checkout: `git -C <tmp>/repo checkout --quiet ${options.ref}`,
    steps: [
      { name: 'clone', command: `git clone --no-hardlinks ${repoRoot} <tmp>/repo`, cwd: '<tmp>' },
      { name: 'checkout', command: `git -C <tmp>/repo checkout --quiet ${options.ref}`, cwd: '<tmp>/repo' },
      { name: 'clone-clean', command: 'git status --porcelain（克隆内）', cwd: '<tmp>/repo' },
      { name: 'install', command: 'pnpm install --frozen-lockfile', cwd: '<tmp>/repo/hephi', skipped: options.skipCheck },
      { name: 'check', command: 'pnpm check', cwd: '<tmp>/repo/hephi', skipped: options.skipCheck },
      { name: 'fake-host-deploy-suite', command: 'node scripts/host/test-deploy-hephi.mjs', cwd: '<tmp>/repo' },
      { name: 'fake-host-effects-db-suite', command: 'node scripts/host/test-effects-db.mjs', cwd: '<tmp>/repo' },
    ],
  }

  const baseReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? 'dry-run' : 'full',
    source: repoRoot,
    ref: options.ref,
    headSha,
    refSha,
    treeClean,
    headMatchesRef,
    node: nodeVersion,
    pnpm: pnpmVersion,
    skipCheck: options.skipCheck,
    steps: [],
    verdict: 'FAIL',
  }

  if (!treeClean) {
    baseReport.error = 'source 工作树不干净：预检必须在已提交的干净候选上运行（git status --porcelain 为空）'
    if (options.out) writeReport(baseReport, options.out)
    printSummary(baseReport)
    return 1
  }
  if (!refIsSha && !headMatchesRef) {
    baseReport.error = `source HEAD (${headSha}) 与 ref (${refSha}) 不一致：非 40hex ref 要求 HEAD==ref`
    if (options.out) writeReport(baseReport, options.out)
    printSummary(baseReport)
    return 1
  }

  if (options.dryRun) {
    baseReport.plan = plan
    baseReport.verdict = 'PASS'
    if (options.out) writeReport(baseReport, options.out)
    printSummary(baseReport)
    return 0
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'hephi-preflight-'))
  const clone = join(tempRoot, 'repo')
  const keep = options.keep
  try {
    const cloneStep = runAndRecord(baseReport, 'clone', 'git', ['clone', '--no-hardlinks', repoRoot, clone], tempRoot, 10 * 60 * 1000)
    if (cloneStep.exit !== 0) return finish(baseReport, options, keep, tempRoot)
    const checkoutStep = runAndRecord(baseReport, 'checkout', 'git', ['-C', clone, 'checkout', '--quiet', options.ref], tempRoot, 5 * 60 * 1000)
    if (checkoutStep.exit !== 0) return finish(baseReport, options, keep, tempRoot)
    const cloneStatus = runAndRecord(baseReport, 'clone-clean', 'git', ['-C', clone, 'status', '--porcelain'], tempRoot, 60 * 1000)
    if (cloneStatus.exit !== 0 || (cloneStatus.tail ?? '') !== '') {
      baseReport.error = '临时克隆工作树不干净（checkout 后 git status 非空）'
      return finish(baseReport, options, keep, tempRoot)
    }

    if (options.skipCheck) {
      baseReport.steps.push(skippedStep('install', 'pnpm install --frozen-lockfile', 'repo/hephi', '--skip-check'))
      baseReport.steps.push(skippedStep('check', 'pnpm check', 'repo/hephi', '--skip-check'))
    } else {
      const install = runAndRecord(baseReport, 'install', 'pnpm', ['install', '--frozen-lockfile'], join(clone, 'hephi'), 30 * 60 * 1000)
      if (install.exit !== 0) return finish(baseReport, options, keep, tempRoot)
      const check = runAndRecord(baseReport, 'check', 'pnpm', ['check'], join(clone, 'hephi'), 30 * 60 * 1000)
      if (check.exit !== 0) return finish(baseReport, options, keep, tempRoot)
    }
    runAndRecord(baseReport, 'fake-host-deploy-suite', 'node', ['scripts/host/test-deploy-hephi.mjs'], clone, 20 * 60 * 1000)
    runAndRecord(baseReport, 'fake-host-effects-db-suite', 'node', ['scripts/host/test-effects-db.mjs'], clone, 20 * 60 * 1000)
    baseReport.headSha = git(clone, ['rev-parse', 'HEAD']).stdout || baseReport.headSha
    baseReport.verdict = baseReport.steps.every(item => item.skipped === true || item.exit === 0) ? 'PASS' : 'FAIL'
    return finish(baseReport, options, keep, tempRoot)
  } finally {
    if (keep) {
      if (baseReport.keptClone === undefined) baseReport.keptClone = clone
      console.error(`[preflight] 临时克隆保留：${clone}`)
    } else {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}

function runAndRecord(report, name, command, args, cwd, timeoutMs) {
  const relativeCwd = cwd.includes('repo') ? cwd.replace(/^.*?repo(?=\/|$)/, 'repo') : cwd
  const record = step(name, command, args, cwd, timeoutMs)
  record.cwd = relativeCwd
  report.steps.push(record)
  return record
}

function writeReport(report, out) {
  try {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.error(`[preflight] JSON 报告：${resolve(out)}`)
  } catch (error) {
    console.error(`[preflight] 写报告失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function printSummary(report) {
  console.log(`[preflight] mode=${report.mode} source=${report.source}`)
  console.log(`[preflight] ref=${report.ref} head=${report.headSha} refSha=${report.refSha} treeClean=${report.treeClean} headMatchesRef=${report.headMatchesRef}`)
  console.log(`[preflight] node=${report.node ?? '(missing)'} pnpm=${report.pnpm ?? '(missing)'} skipCheck=${report.skipCheck}`)
  if (report.mode === 'dry-run') {
    if (report.plan) {
      console.log(`[preflight] clone plan: ${report.plan.clone}`)
      for (const item of report.plan.steps) {
        console.log(`  ${item.skipped ? 'SKIP' : 'STEP'} ${item.name}: ${item.command} (cwd=${item.cwd})`)
      }
      console.log('[preflight] dry-run：未 clone、未运行 check')
    } else {
      console.log('[preflight] dry-run：source 未通过前置校验，未生成克隆计划')
    }
  } else {
    for (const item of report.steps) {
      const status = item.skipped ? 'SKIP' : item.exit === 0 ? 'PASS' : 'FAIL'
      console.log(`  ${status} ${item.name} exit=${item.exit} seconds=${item.seconds}`)
    }
  }
  if (report.error) console.log(`[preflight] ERROR ${report.error}`)
  console.log(`RESULT: ${report.verdict}${report.mode === 'dry-run' ? ' (dry-run)' : ''}`)
}

function finish(report, options, keep, tempRoot) {
  report.verdict = report.steps.every(item => item.skipped === true || item.exit === 0) && !report.error ? 'PASS' : 'FAIL'
  if (keep) report.keptClone = join(tempRoot, 'repo')
  if (options.out) writeReport(report, options.out)
  printSummary(report)
  return report.verdict === 'PASS' ? 0 : 1
}

process.exitCode = main()
