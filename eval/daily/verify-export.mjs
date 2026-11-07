#!/usr/bin/env node
// B8 daily-export cross-check (ROADMAP-95 §B8 / 乙5 观察工具).
//
// 作用：把 `eval/daily/export.mjs` 的输出与**同一源归档**重新计算的结果交叉核对，
// 验证 total/merged/unmerged/dropped/blocked 计数、互斥恒等式、去重键（ticketId）、
// 逐工单状态标记与 P15 uniqueIds 映射。它只读两侧数据，不修改归档、不访问网络。
//
//   node eval/daily/verify-export.mjs --export <daily-export.json> --source <p15-archive.json|dir>
//   node eval/daily/verify-export.mjs --export ... --source ... --out <check.json>
//   node eval/daily/verify-export.mjs --self-test
//
// 交叉核对项（每条 FAIL 即 exit 1）：
//   VE-01/02/03 generator/schemaVersion/dedupKey 必须是 export.mjs 的约定值；
//   VE-04 export.input 必须与本次 --source 解析出的源同路径（防止核对错文件对）；
//   VE-05 counts 字段齐全且为非负整数；
//   VE-06 total/merged/unmerged/dropped/blocked 及互斥细分/PR 关联/byStatus 与源复算完全一致；
//   VE-07 互斥恒等式 total = merged+dropped+blocked+closedUnmerged+openNotBlocked 且 unmerged = total-merged；
//   VE-08 tickets 数组存在、条数=total、ticketId 唯一且集合与源复算一致（去重键核对）；
//   VE-09 逐工单 merged/dropped/blocked/closed 与源复算一致；
//   VE-10 源归档有 summary.json 时，export.inputSummary.uniqueIds 必须等于 counts.total；
//   VE-11 skippedInvalid 与源复算一致。
// 仅告警不失败：源 summary.total 与去重后 total 不同（重复记录，属预期）；byStatus 与源 summary 不同。
//
// 退出码：
//   0  交叉核对全部通过
//   1  存在缺失/不一致（诊断报告照常打印；--out 仍会写出核对报告）
//   2  参数错误、输入文件/源归档不可读或 JSON 非法
//
// 说明：本工具只证明“给定源归档时导出计数可复算”；**没有真实观察窗口数据时它不产生任何计数结论**。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { UsageError, exportDaily, loadInput, summarize } from './export.mjs'

export const SCHEMA_VERSION = 1
export const TOOL_NAME = 'eval/daily/verify-export.mjs'
const REQUIRED_COUNT_KEYS = ['total', 'merged', 'unmerged', 'dropped', 'blocked', 'closedUnmerged', 'openNotBlocked', 'withMergeEvidence', 'prLinked']
const FLAG_KEYS = ['merged', 'dropped', 'blocked', 'closed']

function readJson(filePath, label) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new UsageError(`cannot read ${label} ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${label} is not valid JSON (${filePath}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

function realOrResolved(filePath) {
  const absolute = resolve(filePath)
  try { return realpathSync(absolute) } catch { return absolute }
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return realOrResolved(left) === realOrResolved(right)
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Compare export.mjs output against a freshly recomputed source archive. */
export function verifyExportData(exportData, loaded, { exportFile = null, sourcePath = null, now = new Date().toISOString() } = {}) {
  const recomputed = summarize(loaded.tickets)
  const checks = []
  const warnings = []
  const addCheck = (id, description, ok, detail = null) => { checks.push({ id, description, ok, detail }) }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const counts = isObject(exportData) && isObject(exportData.counts) ? exportData.counts : null

  addCheck('VE-01', 'export.generator is eval/daily/export.mjs', isObject(exportData) && exportData.generator === 'eval/daily/export.mjs', isObject(exportData) ? String(exportData.generator) : 'export is not an object')
  addCheck('VE-02', 'export.schemaVersion is 1', isObject(exportData) && exportData.schemaVersion === 1, isObject(exportData) ? String(exportData.schemaVersion) : 'export is not an object')
  addCheck('VE-03', 'dedupe key is ticketId', isObject(exportData) && exportData.dedupKey === 'ticketId', isObject(exportData) ? String(exportData.dedupKey) : 'export is not an object')
  addCheck('VE-04', 'export.input matches --source', isObject(exportData) && samePath(exportData.input, loaded.source), isObject(exportData) ? `export.input=${String(exportData.input)} source=${loaded.source}` : 'export is not an object')

  const missingKeys = counts === null ? [...REQUIRED_COUNT_KEYS] : REQUIRED_COUNT_KEYS.filter(key => !(key in counts))
  const nonInteger = counts === null ? [] : REQUIRED_COUNT_KEYS.filter(key => typeof counts[key] !== 'number' || !Number.isInteger(counts[key]) || counts[key] < 0)
  addCheck('VE-05', 'counts fields exist and are non-negative integers', counts !== null && missingKeys.length === 0 && nonInteger.length === 0, JSON.stringify({ missingKeys, nonInteger }))

  if (counts !== null && missingKeys.length === 0) {
    const mismatched = []
    for (const key of REQUIRED_COUNT_KEYS) if (!deepEqual(counts[key], recomputed[key])) mismatched.push(`${key}: export=${JSON.stringify(counts[key])} recomputed=${JSON.stringify(recomputed[key])}`)
    if (!deepEqual(counts.byStatus, recomputed.byStatus)) mismatched.push(`byStatus: export=${JSON.stringify(counts.byStatus)} recomputed=${JSON.stringify(recomputed.byStatus)}`)
    addCheck('VE-06', 'total/merged/unmerged/dropped/blocked and split counts match source', mismatched.length === 0, mismatched.join('; ') || null)
  } else {
    addCheck('VE-06', 'total/merged/unmerged/dropped/blocked and split counts match source', false, 'counts incomplete')
  }

  const identityOk = counts !== null && ['total', 'merged', 'unmerged', 'dropped', 'blocked', 'closedUnmerged', 'openNotBlocked'].every(key => typeof counts[key] === 'number')
    && counts.total === counts.merged + counts.dropped + counts.blocked + counts.closedUnmerged + counts.openNotBlocked
    && counts.unmerged === counts.total - counts.merged
  addCheck('VE-07', 'mutually exclusive count identity holds', identityOk, counts === null ? 'counts missing' : JSON.stringify(counts))

  const tickets = isObject(exportData) && Array.isArray(exportData.tickets) ? exportData.tickets : null
  const recomputedIds = loaded.tickets.map(ticket => ticket.ticketId).sort()
  const exportIds = tickets === null ? null : tickets.map(ticket => (isObject(ticket) ? ticket.ticketId : null))
  const exportIdSetSorted = exportIds === null ? null : exportIds.filter(id => typeof id === 'string').sort()
  addCheck(
    'VE-08',
    'tickets array present, unique, and matches source ticketId set',
    tickets !== null && tickets.length === recomputed.total && new Set(exportIds.filter(id => typeof id === 'string')).size === exportIds.length && deepEqual(exportIdSetSorted, recomputedIds),
    tickets === null ? 'export.tickets missing' : JSON.stringify({ exportTickets: tickets.length, total: recomputed.total, unique: new Set(exportIds.filter(id => typeof id === 'string')).size, exportIds: exportIds.length }),
  )

  const flagProblems = []
  if (tickets !== null) {
    const byId = new Map(tickets.filter(isObject).map(ticket => [ticket.ticketId, ticket]))
    for (const ticket of loaded.tickets) {
      const exported = byId.get(ticket.ticketId)
      if (!exported) { flagProblems.push(`${ticket.ticketId}: missing from export.tickets`); continue }
      for (const key of FLAG_KEYS) {
        if (Boolean(exported[key]) !== Boolean(ticket[key])) flagProblems.push(`${ticket.ticketId}.${key}: export=${String(exported[key])} recomputed=${String(ticket[key])}`)
      }
    }
  }
  addCheck('VE-09', 'per-ticket merged/dropped/blocked/closed match source', tickets !== null && flagProblems.length === 0, flagProblems.join('; ') || null)

  const sourceSummary = loaded.summary
  const uniqueIds = isObject(exportData) && isObject(exportData.inputSummary) ? exportData.inputSummary.uniqueIds : null
  if (sourceSummary !== null) {
    addCheck('VE-10', 'source summary uniqueIds equals counts.total', uniqueIds === recomputed.total, `uniqueIds=${String(uniqueIds)} total=${recomputed.total}`)
  } else {
    addCheck('VE-10', 'source summary uniqueIds equals counts.total', true, 'source archive has no summary.json; check skipped')
    warnings.push('源归档没有 summary.json：跳过 P15 uniqueIds 映射核对')
  }

  const skippedInvalid = isObject(exportData) ? exportData.skippedInvalid : undefined
  addCheck('VE-11', 'skippedInvalid matches source recalculation', skippedInvalid === loaded.skippedInvalid, `export=${String(skippedInvalid)} recomputed=${loaded.skippedInvalid}`)

  if (sourceSummary !== null && typeof sourceSummary.total === 'number' && sourceSummary.total !== recomputed.total) {
    warnings.push(`源 summary.total=${sourceSummary.total} 与去重后 total=${recomputed.total} 不同（跨来源重复记录属预期，比较时用 uniqueIds）`)
  }
  if (sourceSummary !== null && isObject(sourceSummary.byStatus) && counts !== null && isObject(counts.byStatus) && !deepEqual(sourceSummary.byStatus, counts.byStatus)) {
    warnings.push('源 summary.byStatus 与去重后 counts.byStatus 不同（重复记录或状态映射差异，需人工解释）')
  }

  const failures = checks.filter(check => !check.ok)
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: TOOL_NAME,
    checkedAt: now,
    exportFile,
    source: loaded.source,
    sourceArg: sourcePath,
    ok: failures.length === 0,
    dedupeKey: isObject(exportData) ? exportData.dedupKey ?? null : null,
    exportCounts: counts,
    recomputedCounts: recomputed,
    ticketCount: recomputed.total,
    checks,
    failures: failures.map(check => check.id),
    warnings,
  }
}

export function verifyExportFiles(exportPath, sourcePath, { now = new Date().toISOString() } = {}) {
  const exportData = readJson(exportPath, '--export')
  const loaded = loadInput(sourcePath)
  return verifyExportData(exportData, loaded, { exportFile: resolve(exportPath), sourcePath: resolve(sourcePath), now })
}

export function parseArgs(argv) {
  const options = { exportPath: null, sourcePath: null, out: null, selfTest: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') { options.selfTest = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (!['--export', '--source', '--out'].includes(arg)) throw new UsageError(`unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new UsageError(`missing value for ${arg}`)
    index += 1
    if (arg === '--export') options.exportPath = value
    if (arg === '--source') options.sourcePath = value
    if (arg === '--out') options.out = value
  }
  if (options.selfTest || options.help) return options
  if (options.exportPath === null) throw new UsageError('--export is required')
  if (options.sourcePath === null) throw new UsageError('--source is required')
  return options
}

function usage() {
  return [
    'usage: node eval/daily/verify-export.mjs --export <daily-export.json> --source <p15-archive.json|dir> [--out <check.json>]',
    '       node eval/daily/verify-export.mjs --self-test',
    '',
    '只读交叉核对：export.mjs 的 total/merged/unmerged/dropped/blocked、互斥恒等式、',
    '去重键 ticketId、逐工单标记与源归档复算是否一致；缺失/不一致 exit 1，IO/参数错误 exit 2。',
  ].join('\n')
}

function printReport(report) {
  for (const check of report.checks) {
    const line = `[verify-export] ${check.ok ? 'PASS' : 'FAIL'} ${check.id} ${check.description}`
    console.log(check.ok || check.detail === null ? line : `${line} :: ${check.detail}`)
  }
  for (const warning of report.warnings) console.log(`[verify-export] WARN ${warning}`)
  console.log(`[verify-export] export=${report.exportFile} source=${report.source}`)
  console.log(`[verify-export] counts: ${JSON.stringify(report.exportCounts)}`)
  console.log(`[verify-export] recomputed: ${JSON.stringify(report.recomputedCounts)}`)
  console.log(`[verify-export] RESULT: ${report.ok ? 'OK (cross-check passed)' : `FAILED (${report.failures.join(', ')})`}`)
}

// ---------------------------------------------------------------------------
// Self-test: synthetic archive + export.mjs output; no real observation data,
// so no real B8 counts are claimed or produced.
// ---------------------------------------------------------------------------
function pass(results, name, condition, detail = '') {
  if (condition) { results.push(`PASS ${name}`); return }
  results.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}

function spawnNode(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { status: typeof result.status === 'number' ? result.status : null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function spawnCli(args) {
  return spawnNode(fileURLToPath(import.meta.url), args)
}

function makeArchive(root) {
  const archive = join(root, 'archive')
  mkdirSync(archive, { recursive: true })
  const tickets = [
    { id: 't-merged', createdAt: '2026-01-01T00:00:00Z', ended: { at: '2026-01-02T00:00:00Z', outcome: 'merged' }, prRefs: ['https://github.com/example/repo/pull/1'] },
    { id: 't-open-blocked', createdAt: '2026-01-03T00:00:00Z', blockedSince: '2026-01-04T00:00:00Z', blockedReason: 'waits for upstream' },
    { id: 't-dropped', createdAt: '2026-01-05T00:00:00Z', ended: { at: '2026-01-06T00:00:00Z', outcome: 'dropped' } },
    { id: 't-open', createdAt: '2026-01-07T00:00:00Z' },
    { id: 't-closed', createdAt: '2026-01-08T00:00:00Z', ended: { at: '2026-01-09T00:00:00Z', outcome: 'completed' } },
    { id: 't-evidence', createdAt: '2026-01-10T00:00:00Z', merged: true, prs: [{ url: 'https://github.com/example/repo/pull/9', state: 'merged' }] },
    { id: 't-merged', createdAt: '2026-01-01T00:00:00Z', merged: true, ended: { at: '2026-01-02T00:00:00Z', outcome: 'merged' } },
  ]
  writeFileSync(join(archive, 'tickets.json'), JSON.stringify(tickets, null, 2))
  writeFileSync(join(archive, 'summary.json'), JSON.stringify({ total: tickets.length, uniqueIds: 6, byStatus: { merged: 2, open: 2, dropped: 1, completed: 1 } }, null, 2))
  return archive
}

function writeExport(root, exportData, name = 'daily-export.json') {
  const path = join(root, name)
  writeFileSync(path, `${JSON.stringify(exportData, null, 2)}\n`)
  return path
}

function snapshotRealDailyFiles() {
  const base = dirname(fileURLToPath(import.meta.url))
  const files = ['export.mjs', 'MAINTENANCE.md', 'APPEALS.md'].map(name => join(base, name))
  return files.map(filePath => {
    try {
      const info = statSync(filePath)
      return { filePath, mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return { filePath, missing: true }
    }
  })
}

export function selfTest() {
  const results = []
  const root = mkdtempSync(join(tmpdir(), 'verify-export-self-'))
  const realBefore = snapshotRealDailyFiles()
  try {
    const archive = makeArchive(root)
    const exportData = exportDaily(archive, { now: '2026-11-07T00:00:00.000Z' })
    const goodExport = writeExport(root, exportData)
    const fixedNow = '2026-11-07T00:00:00.000Z'
    const verify = (data, exportName, source = archive) => verifyExportFiles(writeExport(root, data, exportName), source, { now: fixedNow })

    const good = verify(exportData, 'good.json')
    pass(results, 'valid export/source pair passes all checks', good.ok && good.failures.length === 0, JSON.stringify(good.failures))
    pass(results, 'valid pair counts match recomputation (total=6, merged=2)', good.exportCounts.total === 6 && good.exportCounts.merged === 2 && deepEqual(good.exportCounts, good.recomputedCounts))

    const tamperedMerged = verify({ ...exportData, counts: { ...exportData.counts, merged: 3, unmerged: exportData.counts.total - 3 } }, 'tampered-merged.json')
    pass(results, 'tampered merged count fails VE-06 (exit 1)', !tamperedMerged.ok && tamperedMerged.failures.includes('VE-06'), JSON.stringify(tamperedMerged.failures))

    const tamperedIdentity = { ...exportData, counts: { ...exportData.counts, closedUnmerged: exportData.counts.closedUnmerged + 1 } }
    const identity = verify(tamperedIdentity, 'tampered-identity.json')
    pass(results, 'broken count identity fails VE-07', !identity.ok && identity.failures.includes('VE-07'), JSON.stringify(identity.failures))

    const missingTickets = { ...exportData }
    delete missingTickets.tickets
    const noTickets = verify(missingTickets, 'missing-tickets.json')
    pass(results, 'missing tickets array fails VE-08', !noTickets.ok && noTickets.failures.includes('VE-08'), JSON.stringify(noTickets.failures))

    const duplicateIds = { ...exportData, tickets: [...exportData.tickets, exportData.tickets[0]] }
    const dupIds = verify(duplicateIds, 'duplicate-ids.json')
    pass(results, 'duplicate ticketId in export fails VE-08', !dupIds.ok && dupIds.failures.includes('VE-08'), JSON.stringify(dupIds.failures))

    const wrongKey = { ...exportData, dedupKey: 'id' }
    const badKey = verify(wrongKey, 'wrong-key.json')
    pass(results, 'wrong dedupe key fails VE-03', !badKey.ok && badKey.failures.includes('VE-03'), JSON.stringify(badKey.failures))

    const wrongInput = { ...exportData, input: join(root, 'some-other-archive', 'tickets.json') }
    const badInput = verify(wrongInput, 'wrong-input.json')
    pass(results, 'export.input mismatch fails VE-04', !badInput.ok && badInput.failures.includes('VE-04'), JSON.stringify(badInput.failures))

    const flagMismatch = { ...exportData, tickets: exportData.tickets.map(ticket => ticket.ticketId === 't-open' ? { ...ticket, merged: true } : ticket) }
    const badFlag = verify(flagMismatch, 'bad-flag.json')
    pass(results, 'per-ticket flag mismatch fails VE-09', !badFlag.ok && badFlag.failures.includes('VE-09'), JSON.stringify(badFlag.failures))

    const badUnique = { ...exportData, inputSummary: { ...exportData.inputSummary, uniqueIds: 999 } }
    const unique = verify(badUnique, 'bad-unique.json')
    pass(results, 'uniqueIds mismatch fails VE-10', !unique.ok && unique.failures.includes('VE-10'), JSON.stringify(unique.failures))

    // CLI: valid pair exit 0 (+ --out report); tampered pair exit 1; IO/usage exit 2.
    const outPath = join(root, 'check.json')
    const cliGood = spawnCli(['--export', goodExport, '--source', archive, '--out', outPath])
    const cliReport = JSON.parse(readFileSync(outPath, 'utf8'))
    pass(results, 'CLI valid pair exits 0 and writes a report', cliGood.status === 0 && cliReport.ok === true && cliReport.failures.length === 0, `status=${cliGood.status} stderr=${cliGood.stderr}`)
    // End-to-end through both real CLI entry points: export.mjs -> verify-export.mjs.
    const exportScript = join(dirname(fileURLToPath(import.meta.url)), 'export.mjs')
    const cliExportPath = join(root, 'cli-export.json')
    const exportCli = spawnNode(exportScript, ['--input', archive, '--out', cliExportPath])
    const verifyCli = spawnNode(fileURLToPath(import.meta.url), ['--export', cliExportPath, '--source', archive])
    pass(results, 'CLI export.mjs output is accepted by CLI verify-export (exit 0)', exportCli.status === 0 && verifyCli.status === 0, `export=${exportCli.status} verify=${verifyCli.status} stderr=${verifyCli.stderr}`)

    const cliBad = spawnCli(['--export', writeExport(root, { ...exportData, counts: { ...exportData.counts, total: 99 } }, 'cli-bad.json'), '--source', archive])
    pass(results, 'CLI tampered pair exits 1', cliBad.status === 1, `status=${cliBad.status}`)
    pass(results, 'CLI missing --source exits 2', spawnCli(['--export', goodExport]).status === 2)
    pass(results, 'CLI unknown argument exits 2', spawnCli(['--export', goodExport, '--source', archive, '--bogus']).status === 2)
    pass(results, 'CLI nonexistent export file exits 2', spawnCli(['--export', join(root, 'nope.json'), '--source', archive]).status === 2)
    const emptyArchive = join(root, 'empty-archive')
    mkdirSync(emptyArchive, { recursive: true })
    pass(results, 'CLI source archive without tickets.json exits 2', spawnCli(['--export', goodExport, '--source', emptyArchive]).status === 2)

    // Source without summary.json: mapping check is skipped (warning, not failure).
    const noSummaryRoot = join(root, 'no-summary-archive')
    mkdirSync(noSummaryRoot, { recursive: true })
    writeFileSync(join(noSummaryRoot, 'tickets.json'), readFileSync(join(archive, 'tickets.json')))
    const noSummaryExport = exportDaily(noSummaryRoot, { now: '2026-11-07T00:00:00.000Z' })
    const noSummary = verify(noSummaryExport, 'no-summary.json', noSummaryRoot)
    pass(results, 'source without summary.json skips uniqueIds check with warning', noSummary.ok && noSummary.warnings.some(warning => warning.includes('summary.json')))

    // Self-test must not modify real eval/daily files.
    const realAfter = snapshotRealDailyFiles()
    pass(results, 'self-test does not modify real eval/daily files', JSON.stringify(realBefore) === JSON.stringify(realAfter), JSON.stringify({ realBefore, realAfter }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  for (const line of results) console.log(line)
  const failed = results.filter(line => line.startsWith('FAIL')).length
  if (failed > 0) {
    console.log(`\nFAILED: ${failed} assertion(s)`)
    return 1
  }
  console.log(`\nPASS: ${results.length} assertions (verify-export self-test; synthetic fixtures only; no real B8 observation data)`)
  return 0
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options = null
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    process.exitCode = 2
  }
  if (options) {
    if (options.help) {
      console.log(usage())
      process.exitCode = 0
    } else if (options.selfTest) {
      process.exitCode = selfTest()
    } else {
      try {
        const report = verifyExportFiles(options.exportPath, options.sourcePath)
        printReport(report)
        if (options.out !== null) {
          const outPath = resolve(options.out)
          mkdirSync(dirname(outPath), { recursive: true })
          writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
          console.log(`[verify-export] WROTE ${outPath}`)
        }
        process.exitCode = report.ok ? 0 : 1
      } catch (error) {
        console.error(`[verify-export] ERROR: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = error instanceof UsageError ? 2 : 1
      }
    }
  }
}
