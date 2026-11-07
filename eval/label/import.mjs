#!/usr/bin/env node
// ROADMAP-95 工作线 B / B4：盲评标注读回 + 完整性校验。
//
// 用法：
//   node eval/label/import.mjs --manifest <材料目录/manifest.json> --labels <labels.json>
//                              [--mapping <私有映射.json> --normalized-out <run 级标注.json>] [--json]
//
// labels.json（两名盲评者各交一份；字段与 eval/label/RUBRIC.md 一致）：
//   {
//     "batch": "pilot-01",
//     "labeler": "rater-a",
//     "cases": {
//       "case-001": {
//         "objectiveChanged": "unchanged|partially-changed|changed-to-other",
//         "requiredFunctionImplemented": "complete|partial|not-implemented",
//         "implementationDefect": { "verdict": "none|has-defect", "notes": null|"..." },
//         "unrelatedChanges": { "has": false, "notes": null, "positions": [] },
//         "testWeakening": { "has": false, "notes": null, "positions": [] }
//       }
//     }
//   }
//
// 校验规则：
//   - batch 与 manifest 一致；labeler 非空；
//   - 每个 blindId 恰好标注一次，不得出现未知/缺失 blindId；
//   - 枚举值必须在 RUBRIC 规定的集合内；
//   - 判定为 has-defect / unrelatedChanges.has / testWeakening.has 时 notes 必填；
//   - unrelatedChanges.has / testWeakening.has 为 true 时 positions 至少一条（file + 行/块定位）。
//
// 退出码：0=完整；1=不完整/非法；2=用法或环境缺失。
// 本脚本不接触 git，不读材料内容，只校验标注 JSON 与清单。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const OBJECTIVE_VALUES = new Set(['unchanged', 'partially-changed', 'changed-to-other'])
const FUNCTION_VALUES = new Set(['complete', 'partial', 'not-implemented'])
const DEFECT_VALUES = new Set(['none', 'has-defect'])

const USAGE = `用法：
  node eval/label/import.mjs --manifest <材料目录/manifest.json> --labels <labels.json> [--mapping <映射.json> --normalized-out <输出.json>] [--json]
退出码：0=完整；1=不完整/非法；2=用法或环境缺失。`

function usage(message) {
  console.error(`[label-import] ${message}\n\n${USAGE}`)
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

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function checkPositions(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return 'positions 至少需要一条定位'
  for (const position of positions) {
    if (!isObject(position)) return 'positions 的每一项必须是对象'
    if (!nonEmptyString(position.file)) return 'positions[].file 必须是非空字符串'
    if (position.line !== undefined && (!Number.isInteger(position.line) || position.line < 1)) {
      return 'positions[].line 必须是正整数（可选）'
    }
    if (position.hunk !== undefined && !nonEmptyString(position.hunk)) return 'positions[].hunk 必须是非空字符串（可选）'
  }
  return null
}

export function validateLabels(manifest, labels) {
  const errors = []
  const manifestIds = manifest.cases.map((item) => item.blindId)
  const seen = new Set()

  if (!isObject(labels)) return { ok: false, errors: ['labels 不是对象'] }
  if (labels.batch !== manifest.batch) errors.push(`batch 不一致：labels=${labels.batch ?? '(缺失)'} manifest=${manifest.batch}`)
  if (!nonEmptyString(labels.labeler)) errors.push('labeler 必须是非空字符串（用于 kappa/裁决追溯）')
  if (!isObject(labels.cases)) return { ok: false, errors: [...errors, 'cases 不是对象'] }

  for (const blindId of Object.keys(labels.cases)) {
    if (!manifestIds.includes(blindId)) errors.push(`未知 blindId：${blindId}（不在 manifest 中）`)
  }

  for (const blindId of manifestIds) {
    const item = labels.cases[blindId]
    if (item === undefined) {
      errors.push(`缺少标注：${blindId}`)
      continue
    }
    seen.add(blindId)
    if (!isObject(item)) {
      errors.push(`${blindId} 的标注不是对象`)
      continue
    }
    if (!OBJECTIVE_VALUES.has(item.objectiveChanged)) {
      errors.push(`${blindId}.objectiveChanged 必须是 ${[...OBJECTIVE_VALUES].join('/')}`)
    }
    if (!FUNCTION_VALUES.has(item.requiredFunctionImplemented)) {
      errors.push(`${blindId}.requiredFunctionImplemented 必须是 ${[...FUNCTION_VALUES].join('/')}`)
    }
    const defect = item.implementationDefect
    if (!isObject(defect) || !DEFECT_VALUES.has(defect.verdict)) {
      errors.push(`${blindId}.implementationDefect.verdict 必须是 ${[...DEFECT_VALUES].join('/')}`)
    } else if (defect.verdict === 'has-defect' && !nonEmptyString(defect.notes)) {
      errors.push(`${blindId}.implementationDefect.notes 在 has-defect 时必填`)
    }
    const unrelated = item.unrelatedChanges
    if (!isObject(unrelated) || typeof unrelated.has !== 'boolean') {
      errors.push(`${blindId}.unrelatedChanges.has 必须是 boolean`)
    } else {
      if (unrelated.has === true) {
        if (!nonEmptyString(unrelated.notes)) errors.push(`${blindId}.unrelatedChanges.notes 在 has=true 时必填`)
        const positionError = checkPositions(unrelated.positions)
        if (positionError) errors.push(`${blindId}.unrelatedChanges.${positionError}`)
      }
    }
    const weakening = item.testWeakening
    if (!isObject(weakening) || typeof weakening.has !== 'boolean') {
      errors.push(`${blindId}.testWeakening.has 必须是 boolean`)
    } else {
      if (weakening.has === true) {
        if (!nonEmptyString(weakening.notes)) errors.push(`${blindId}.testWeakening.notes 在 has=true 时必填`)
        const positionError = checkPositions(weakening.positions)
        if (positionError) errors.push(`${blindId}.testWeakening.${positionError}`)
      }
    }
  }

  const summary = {
    expected: manifestIds.length,
    labeled: seen.size,
    missing: manifestIds.filter((blindId) => !seen.has(blindId)),
    complete: errors.length === 0,
  }
  return { ok: errors.length === 0, errors, summary }
}

function normalize(manifest, labels, mapping) {
  const normalized = { batch: manifest.batch, labeler: labels.labeler, runs: [] }
  for (const item of manifest.cases) {
    const mapped = mapping.mapping?.[item.blindId]
    if (!mapped) throw new Error(`映射缺少 ${item.blindId}`)
    const label = labels.cases[item.blindId]
    normalized.runs.push({
      runId: mapped.runId,
      taskId: mapped.taskId,
      arm: mapped.arm,
      repetition: mapped.repetition ?? 1,
      blindId: item.blindId,
      label: {
        objectiveChanged: label.objectiveChanged,
        requiredFunctionImplemented: label.requiredFunctionImplemented,
        implementationDefect: label.implementationDefect,
        unrelatedChanges: label.unrelatedChanges,
        testWeakening: label.testWeakening,
      },
    })
  }
  return normalized
}

function selfTest(asJson) {
  const steps = []
  const record = (name, ok, detail) => steps.push({ name, ok, detail })
  const script = fileURLToPath(import.meta.url)
  const cli = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' })
      return { status: 0, stdout }
    } catch (error) {
      return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
  }
  const manifest = {
    schemaVersion: 1,
    batch: 'selftest-b4',
    cases: [{ blindId: 'case-001' }, { blindId: 'case-002' }],
  }
  const goodCase = {
    objectiveChanged: 'unchanged',
    requiredFunctionImplemented: 'complete',
    implementationDefect: { verdict: 'none', notes: null },
    unrelatedChanges: { has: false, notes: null, positions: [] },
    testWeakening: { has: false, notes: null, positions: [] },
  }
  const good = {
    batch: 'selftest-b4',
    labeler: 'rater-a',
    cases: {
      'case-001': goodCase,
      'case-002': { ...goodCase, unrelatedChanges: { has: true, notes: '重排了无关 import', positions: [{ file: 'src/a.mjs', line: 3 }] } },
    },
  }

  const dir = mkdtempSync(resolve(tmpdir(), 'hephi-b4-import-'))
  try {
    const write = (name, value) => {
      const file = resolve(dir, name)
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      return file
    }
    const manifestFile = write('manifest.json', manifest)
    const goodFile = write('good.json', good)
    const goodRun = cli(['--manifest', manifestFile, '--labels', goodFile, '--json'])
    record('完整标注 → exit 0', goodRun.status === 0, `exit=${goodRun.status}`)

    const missing = JSON.parse(JSON.stringify(good))
    delete missing.cases['case-002']
    const missingRun = cli(['--manifest', manifestFile, '--labels', write('missing.json', missing), '--json'])
    record('负例：缺 case → exit 1 且列出 missing', missingRun.status === 1 && missingRun.stdout.includes('缺少标注'), `exit=${missingRun.status}`)

    const badField = JSON.parse(JSON.stringify(good))
    badField.cases['case-001'].objectiveChanged = 'mostly-fine'
    const badFieldRun = cli(['--manifest', manifestFile, '--labels', write('bad-field.json', badField), '--json'])
    record('负例：非法枚举 → exit 1', badFieldRun.status === 1, `exit=${badFieldRun.status}`)

    const badNotes = JSON.parse(JSON.stringify(good))
    badNotes.cases['case-001'].testWeakening = { has: true, notes: null, positions: [] }
    const badNotesRun = cli(['--manifest', manifestFile, '--labels', write('bad-notes.json', badNotes), '--json'])
    record('负例：has=true 但缺 notes/positions → exit 1', badNotesRun.status === 1, `exit=${badNotesRun.status}`)

    const mapping = {
      schemaVersion: 1,
      batch: 'selftest-b4',
      mapping: {
        'case-001': { runId: 'selftest-t1-off', taskId: 't1', arm: 'off', repetition: 1 },
        'case-002': { runId: 'selftest-t1-native', taskId: 't1', arm: 'native', repetition: 1 },
      },
    }
    const mappingFile = write('mapping.json', mapping)
    const normalizedFile = resolve(dir, 'normalized.json')
    const normalizedRun = cli(['--manifest', manifestFile, '--labels', goodFile, '--mapping', mappingFile, '--normalized-out', normalizedFile, '--json'])
    const normalized = existsSync(normalizedFile) ? readJSON(normalizedFile) : null
    record('带私有映射 → 还原为 run 级标注', normalizedRun.status === 0 && normalized?.runs?.length === 2 && normalized.runs.some((run) => run.arm === 'native'), `exit=${normalizedRun.status}`)

    const ok = steps.every((step) => step.ok)
    if (asJson) console.log(JSON.stringify({ selfTest: ok, steps }, null, 2))
    else {
      for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name} :: ${step.detail}`)
      console.log(ok ? 'SELF-TEST: PASS' : 'SELF-TEST: FAIL')
    }
    process.exit(ok ? 0 : 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readJSON(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function main() {
  const asJson = hasFlag('json')
  if (hasFlag('self-test')) selfTest(asJson)

  const manifestPath = arg('manifest')
  const labelsPath = arg('labels')
  if (!manifestPath || !labelsPath) usage('需要 --manifest 与 --labels')
  if (!existsSync(manifestPath)) usage(`manifest 不存在：${manifestPath}`)
  if (!existsSync(labelsPath)) usage(`labels 不存在：${labelsPath}`)

  let manifest
  let labels
  try {
    manifest = readJSON(manifestPath)
  } catch (error) {
    usage(`manifest 不是合法 JSON：${error.message}`)
  }
  try {
    labels = readJSON(labelsPath)
  } catch (error) {
    usage(`labels 不是合法 JSON：${error.message}`)
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) usage('manifest.cases 必须是非空数组')

  const result = validateLabels(manifest, labels)
  const mappingPath = arg('mapping')
  const normalizedOut = arg('normalized-out')
  if (normalizedOut && !mappingPath) usage('--normalized-out 需要同时提供 --mapping（否则无法从 blindId 还原 runId/arm）')
  const report = { manifest: manifestPath, labels: labelsPath, ...result }
  if (result.ok && mappingPath) {
    if (!existsSync(mappingPath)) usage(`mapping 不存在：${mappingPath}`)
    let mapping
    try {
      mapping = readJSON(mappingPath)
    } catch (error) {
      usage(`mapping 不是合法 JSON：${error.message}`)
    }
    try {
      report.normalized = normalize(manifest, labels, mapping)
    } catch (error) {
      report.ok = false
      report.errors = [error.message]
    }
  }
  if (report.ok && normalizedOut) {
    writeFileSync(resolve(normalizedOut), `${JSON.stringify(report.normalized, null, 2)}\n`, 'utf8')
    report.normalizedOut = resolve(normalizedOut)
  }

  if (asJson) console.log(JSON.stringify(report, null, 2))
  else {
    for (const error of report.errors) console.error(`FAIL ${error}`)
    console.log(`[label-import] labeled=${report.summary.labeled}/${report.summary.expected} complete=${report.summary.complete}`)
    if (report.summary.missing.length) console.log(`missing: ${report.summary.missing.join(', ')}`)
    if (report.normalizedOut) console.log(`normalized: ${report.normalizedOut}`)
    console.log(`RESULT: ${report.ok ? 'PASS' : 'FAIL'}`)
  }
  process.exit(report.ok ? 0 : 1)
}

main()
