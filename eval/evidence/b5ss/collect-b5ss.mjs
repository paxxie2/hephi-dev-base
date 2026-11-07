#!/usr/bin/env node
// B5 样本量/成本草案证据生成器（task-13）。
//
// 只读：宿主 B 的 orchestrator sqlite（-readonly）、宿主 B 的 worker session 日志（zstd -dc）、
// 仓库内 eval/evidence/b5off/ticket-*.json；不写宿主、不跑实验、不调用模型。
// 输出全部写到 eval/evidence/b5ss/（由调用者的 shell 重定向/本脚本写入），本脚本只写本目录。
//
// 用法：
//   node eval/evidence/b5ss/collect-b5ss.mjs
// 可用环境变量覆盖只读输入位置：
//   B5SS_DB        default /Users/zm/dsh-instances/experiment/state/orchestrator.sqlite
//   B5SS_SESSIONS  default /Users/zm/dsh-instances/experiment/dsh-home/sessions
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const DB = process.env.B5SS_DB || '/Users/zm/dsh-instances/experiment/state/orchestrator.sqlite'
const SESSIONS = process.env.B5SS_SESSIONS || '/Users/zm/dsh-instances/experiment/dsh-home/sessions'

const NATIVE_TICKETS = {
  '0824a46875fffff5193152a320073ea6': 'run1',
  '2801319d520b9bd81c3c3a3f6d821167': 'run1-retry',
  '078370bcf6d73a168f2256e693aa36c4': 'run2',
  'ba9cbe09e06842e47993cfd147988aee': 'run3',
}
const OFF_TICKET_RUN = {
  'ticket-a1cd12aacb7fa21db019a85f68051a37.json': 'run1',
  'ticket-f0707370fc2fd9f7788eb6ddcd4adc0b.json': 'run1-retry',
  'ticket-86d714f089dabc6e909a878cec40eb45.json': 'run2',
  'ticket-10b8b5256d303017ded3187ea1c0ae11.json': 'run3',
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function isoToMs(value) {
  return value === null || value === undefined ? null : Date.parse(value)
}

function seconds(from, to) {
  if (from === null || to === null) return null
  return Math.round(((to - from) / 1000) * 1000) / 1000
}

// R type-7 / Excel PERCENTILE.INC linear interpolation; n=4 => descriptive only.
function percentile(values, p) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  if (xs.length === 1) return xs[0]
  const index = (xs.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return xs[lower]
  return Math.round((xs[lower] + (xs[upper] - xs[lower]) * (index - lower)) * 1000) / 1000
}

function sum(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0)
}

// ---- read-only native tickets -------------------------------------------------
function nativeTickets() {
  const ids = Object.keys(NATIVE_TICKETS).map((id) => `'${id}'`).join(',')
  const query = `SELECT id, value FROM ticket WHERE id IN (${ids}) ORDER BY id`
  const stdout = execFileSync('sqlite3', ['-readonly', '-json', DB, query], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const rows = JSON.parse(stdout)
  const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.value)]))
  const out = []
  for (const [id, run] of Object.entries(NATIVE_TICKETS)) {
    const value = byId.get(id)
    if (!value) throw new Error(`native ticket missing: ${id}`)
    const assignment = (value.assignments || [])[0] || {}
    const report = assignment.report || {}
    const created = isoToMs(assignment.createdAt ?? value.createdAt ?? null)
    const started = isoToMs(assignment.startedAt ?? null)
    const reportAt = isoToMs(report.at ?? null)
    const idleAt = isoToMs(assignment.idleAt ?? null)
    const turnEndedAt = isoToMs(assignment.turnEndedAt ?? null)
    const endedAt = isoToMs(assignment.endedAt ?? null)
    const execution = value.execution || {}
    out.push({
      arm: 'native', run, ticketId: id, title: value.title ?? null,
      state: report.state ?? null, directory: execution.directory ?? null,
      sessionId: `worker-${id}`,
      timestamps: {
        createdAt: assignment.createdAt ?? null, startedAt: assignment.startedAt ?? null,
        reportAt: report.at ?? null, idleAt: assignment.idleAt ?? null,
        turnEndedAt: assignment.turnEndedAt ?? null, endedAt: assignment.endedAt ?? null,
      },
      raw: { created, started, reportAt, idleAt, turnEndedAt, endedAt },
    })
  }
  return out
}

// ---- read-only off tickets (already committed evidence) ----------------------
function offTickets() {
  const out = []
  for (const [file, run] of Object.entries(OFF_TICKET_RUN)) {
    const path = join(REPO, 'eval/evidence/b5off', file)
    const text = readFileSync(path, 'utf8')
    const value = JSON.parse(text)
    const assignment = (value.assignments || [])[0] || {}
    const report = assignment.report || {}
    out.push({
      arm: 'off', run, ticketId: value.id ?? null, title: value.title ?? null,
      state: report.state ?? null, sourceFile: `eval/evidence/b5off/${file}`, sourceSha256: sha256(text),
      timestamps: {
        createdAt: assignment.createdAt ?? null, startedAt: assignment.startedAt ?? null,
        reportAt: report.at ?? null, idleAt: assignment.idleAt ?? null,
        turnEndedAt: assignment.turnEndedAt ?? null, endedAt: assignment.endedAt ?? null,
      },
      raw: {
        created: isoToMs(assignment.createdAt ?? null), started: isoToMs(assignment.startedAt ?? null),
        reportAt: isoToMs(report.at ?? null), idleAt: isoToMs(assignment.idleAt ?? null),
        turnEndedAt: isoToMs(assignment.turnEndedAt ?? null), endedAt: isoToMs(assignment.endedAt ?? null),
      },
    })
  }
  return out
}

function withDurations(run) {
  const raw = run.raw
  const durations = {
    queueSeconds: seconds(raw.created, raw.started),
    workerSeconds: seconds(raw.started, raw.reportAt),
    endToEndSeconds: seconds(raw.created, raw.reportAt),
    turnToIdleSeconds: seconds(raw.started, raw.turnEndedAt ?? raw.idleAt),
    openToEndedSeconds: seconds(raw.created, raw.endedAt),
    postReportIdleSeconds: seconds(raw.reportAt, raw.idleAt),
  }
  const { raw: _drop, ...rest } = run
  return { ...rest, durations }
}

// ---- native token usage from worker session logs (read-only zstd) -----------
function sessionPathFor(directory, sessionId) {
  const escaped = directory.replaceAll('/', '-')
  return join(SESSIONS, `-${escaped}--`, sessionId, 'session.v4.jsonl.zstd')
}

function nativeUsage(tickets) {
  const rows = []
  for (const ticket of tickets) {
    const path = sessionPathFor(ticket.directory, ticket.sessionId)
    if (!existsSync(path)) {
      rows.push({ arm: 'native', run: ticket.run, ticketId: ticket.ticketId, available: false, reason: `session log not found: ${path}`, usage: null })
      continue
    }
    const stdout = execFileSync('zstd', ['-dc', path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    const steps = []
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let event
      try { event = JSON.parse(trimmed) } catch { continue }
      const usage = (event.data || {}).usage
      if (usage && typeof usage === 'object') steps.push(usage)
    }
    const totals = {}
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens']) {
      totals[key] = sum(steps.map((step) => step[key]))
    }
    // totalTokens 在 DSH session 日志里 = input+output+cacheRead+cacheWrite（含缓存读取）；
    // 同时给出不含缓存读取的 input+output，避免把缓存读取当独立计费项。
    totals.nonCacheInputOutput = (totals.inputTokens ?? 0) + (totals.outputTokens ?? 0)
    rows.push({
      arm: 'native', run: ticket.run, ticketId: ticket.ticketId, available: true,
      source: `host worker session log (${path.split('/sessions/')[1]})`,
      steps: steps.length, usage: totals,
      notes: 'DSH session 日志按模型调用逐步记录；totalTokens 为各步 input+output+cacheRead+cacheWrite 之和，包含缓存读取，不必然等于供应商计费口径。',
    })
  }
  return rows
}

// ---- sample-size sensitivity grid -------------------------------------------
function runPilot(input) {
  const file = join(HERE, `.pilot-${process.pid}.json`)
  writeFileSync(file, `${JSON.stringify(input)}\n`)
  try {
    const result = execFileSync(process.execPath, [join(REPO, 'eval/prereg-sample.mjs'), '--pilot', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, output: JSON.parse(result), stderr: null }
  } catch (error) {
    return { status: typeof error.status === 'number' ? error.status : null, output: null, stderr: String(error.stderr || error.message).trim().split('\n')[0] }
  } finally {
    try { unlinkSync(file) } catch { /* ignore */ }
  }
}

function grid() {
  const pairs = 4 // 真实已配对数量：4 native + 4 off（pilot 只回显，不参与 N 计算）
  const attempts = []
  const push = (row) => {
    const input = {
      pairs,
      successRateOff: row.successRateOff,
      successRateNative: row.successRateNative,
      discordantRate: row.discordantRate,
      alpha: row.alpha,
      power: row.power,
      margin: row.margin,
    }
    const result = runPilot(input)
    attempts.push({
      label: row.label,
      input,
      improvement: Math.round((input.successRateNative - input.successRateOff) * 1000) / 1000,
      exitCode: result.status,
      requiredPairs: result.output ? result.output.requiredPairs : null,
      method: result.output ? result.output.method : null,
      notes: result.output ? result.output.notes : null,
      invalidReason: result.status === 0 ? null : (result.stderr || null),
    })
  }
  const offRates = [0.6, 0.7, 0.8]
  const improvements = [0.05, 0.1, 0.15, 0.2]
  const discords = [0.2, 0.3]
  const alphas = [0.05, 0.1]
  const powers = [0.8, 0.9]
  for (const offRate of offRates) {
    for (const improvement of improvements) {
      for (const discordantRate of discords) {
        for (const alpha of alphas) {
          for (const power of powers) {
            push({ label: 'core', successRateOff: offRate, successRateNative: Math.round((offRate + improvement) * 100) / 100, discordantRate, alpha, power, margin: -0.05 })
          }
        }
      }
    }
  }
  for (const margin of [-0.03, -0.05, -0.1]) {
    push({ label: 'margin-sensitivity', successRateOff: 0.7, successRateNative: 0.8, discordantRate: 0.2, alpha: 0.05, power: 0.8, margin })
  }
  const valid = attempts.filter((row) => row.exitCode === 0)
  const invalid = attempts.filter((row) => row.exitCode !== 0)
  const byImprovementPower = {}
  for (const improvement of improvements) {
    for (const power of powers) {
      const row = attempts.find((x) => x.label === 'core' && x.input.successRateOff === 0.7 && x.input.discordantRate === 0.2 && x.input.alpha === 0.05 && x.input.power === power && Math.abs(x.improvement - improvement) < 1e-9)
      byImprovementPower[`d=${improvement},power=${power}`] = row ? row.requiredPairs : null
    }
  }
  const coreValid = valid.filter((row) => row.label === 'core')
  return {
    method: 'eval/prereg-sample.mjs --pilot <json>（paired Bernoulli Wald 近似 / 非劣效 margin）',
    pilotPairs: pairs,
    gridDefinition: {
      labelCore: 'offRate × improvement(d) × discordantRate × alpha × power，margin=-0.05',
      offRates, improvements, discords, alphas, powers, margin: -0.05,
      labelMarginSensitivity: 'offRate=0.7, d=0.10, q=0.20, alpha=0.05, power=0.8, margin ∈ {-0.03,-0.05,-0.10}',
      note: '输入是假设情景，不是从 8 次试跑估计的效应；pairs=4 只是回显真实配对数，不参与 N 计算。',
    },
    attempts: attempts.length,
    valid: valid.length,
    invalid: invalid.length,
    requiredPairsRange: {
      allValid: coreValid.length ? { min: Math.min(...coreValid.map((r) => r.requiredPairs)), max: Math.max(...coreValid.map((r) => r.requiredPairs)) } : null,
      atPrimaryAssumption: byImprovementPower,
    },
    rows: attempts,
  }
}

function summaryOf(nativeUsageRows) {
  const totals = nativeUsageRows.map((row) => row.usage)
  return {
    runs: nativeUsageRows.map((row) => ({ run: row.run, ticketId: row.ticketId, steps: row.steps, usage: row.usage })),
    aggregate: {
      runsAvailable: totals.length,
      totalTokensSum: sum(totals.map((row) => row.totalTokens)),
      totalTokensMedian: percentile(totals.map((row) => row.totalTokens), 0.5),
      totalTokensP90: percentile(totals.map((row) => row.totalTokens), 0.9),
      nonCacheInputOutputSum: sum(totals.map((row) => row.nonCacheInputOutput)),
      nonCacheInputOutputMedian: percentile(totals.map((row) => row.nonCacheInputOutput), 0.5),
      nonCacheInputOutputP90: percentile(totals.map((row) => row.nonCacheInputOutput), 0.9),
    },
  }
}

function buildCost(timings, tokenSummary, offUsageRows) {
  const flat = timings.runs
  const sumOf = (arm, name) => sum(flat.filter((row) => row.arm === arm).map((row) => row.durations[name]))
  const nativeReady = flat.filter((row) => row.arm === 'native' && row.state === 'ready')
  const median = (rows, name) => percentile(rows.map((row) => row.durations[name]), 0.5)
  const p90 = (rows, name) => percentile(rows.map((row) => row.durations[name]), 0.9)
  const nativeMedian = median(flat.filter((row) => row.arm === 'native'), 'workerSeconds')
  const offMedian = median(flat.filter((row) => row.arm === 'off'), 'workerSeconds')
  const nativeP90 = p90(flat.filter((row) => row.arm === 'native'), 'workerSeconds')
  const offP90 = p90(flat.filter((row) => row.arm === 'off'), 'workerSeconds')
  const nativeReadyMedian = median(nativeReady, 'workerSeconds')
  const perPairMedian = nativeMedian + offMedian
  const perPairP90 = nativeP90 + offP90
  const perPairReadyMedian = nativeReadyMedian + offMedian
  const round = (value) => Math.round(value * 100) / 100
  const pairs = [21, 27, 35, 47, 67, 89, 156, 208]
  return {
    note: '只汇总真实可读数据；不编造价格、额度或并发上限。金额一律 unknown。',
    money: {
      available: false,
      value: 'unknown',
      reason: '仓库/证据中没有真实价目、模型单价或预算额度（eval/PREREG.md §5 为占位、eval/check-budget.mjs 缺金额/币种/上限）；因此不做金额折算。',
    },
    duration: {
      observed8Runs: {
        nativeWorkerSumSeconds: sumOf('native', 'workerSeconds'),
        offWorkerSumSeconds: sumOf('off', 'workerSeconds'),
        totalWorkerSumSeconds: sumOf('native', 'workerSeconds') + sumOf('off', 'workerSeconds'),
        nativeEndToEndSumSeconds: sumOf('native', 'endToEndSeconds'),
        offEndToEndSumSeconds: sumOf('off', 'endToEndSeconds'),
      },
      perPairSeconds: {
        medianNativePlusOff: round(perPairMedian),
        p90NativePlusOff: round(perPairP90),
        readyNativeMedianPlusOffMedian: round(perPairReadyMedian),
        definitions: 'per-pair = native workerSeconds + off workerSeconds（假设两臂先后/各 1 并发执行，一对耗时相加）',
      },
      formalRoundSequentialHostMinutes: {
        assumptions: '按每对 native+off 顺序执行、每组并发 1 估算主机分钟；并发上限未验证，实际可除以并发数，但不是已验证承诺。',
        rows: pairs.map((n) => ({
          pairs: n,
          medianMinutes: round((n * perPairMedian) / 60),
          p90Minutes: round((n * perPairP90) / 60),
          readyMedianMinutes: round((n * perPairReadyMedian) / 60),
        })),
      },
      concurrency: 'unknown（宿主/off 并发限制未验证）',
    },
    tokens: {
      native: tokenSummary,
      off: { available: false, rows: offUsageRows, value: 'unknown', reason: 'off 实例 DSH_HOME（/tmp/hephi-off-b5）已按设计清理，仓库证据无 usage/token；null 不补 0。' },
      price: 'unknown（无价目数据，不编造）',
      caveat: 'native 的 totalTokens 来自 DSH worker session 日志，按模型调用逐步累加且包含 cacheReadTokens；PREREG §5 的 token 字段未定义口径、且上限是占位未批准，故不能据此判定成本是否超限。',
    },
  }
}

function main() {
  const nativeRaw = nativeTickets()
  const native = nativeRaw.map((row) => withDurations(row))
  const off = offTickets().map((row) => withDurations(row))
  const usage = nativeUsage(nativeRaw)
  const timings = {
    method: 'workerSeconds = report.at - startedAt；endToEndSeconds = report.at - createdAt；queueSeconds = startedAt - createdAt；turnToIdleSeconds = (turnEndedAt ?? idleAt) - startedAt；openToEndedSeconds/endedAt 仅 native 有、是宿主停止/清理时的批处理时间，不计入运行时长统计。缺失时间戳保持 null，不补 0。',
    sources: {
      native: `sqlite3 -readonly ${DB} "select id, value from ticket where id in (4 native ids)"`,
      off: 'eval/evidence/b5off/ticket-*.json（4 个真实 off ticket）',
      tokens: `宿主 B worker session 日志 ${SESSIONS}/*/worker-*/session.v4.jsonl.zstd（只读 zstd -dc）`,
    },
    runs: [...native, ...off],
  }
  const summarizeRows = (arm, rows) => {
    const metric = (name) => ({
      values: rows.map((row) => ({ run: row.run, state: row.state, value: row.durations[name] })),
      median: percentile(rows.map((row) => row.durations[name]), 0.5),
      p90: percentile(rows.map((row) => row.durations[name]), 0.9),
      nulls: rows.filter((row) => row.durations[name] === null).map((row) => row.run),
    })
    return {
      arm, n: rows.length,
      states: rows.map((row) => ({ run: row.run, state: row.state })),
      workerSeconds: metric('workerSeconds'),
      endToEndSeconds: metric('endToEndSeconds'),
      queueSeconds: metric('queueSeconds'),
      turnToIdleSeconds: metric('turnToIdleSeconds'),
      openToEndedSeconds: metric('openToEndedSeconds'),
      postReportIdleSeconds: metric('postReportIdleSeconds'),
    }
  }
  timings.summary = {
    note: 'n=4/组：median/p90 只是描述性统计，p90 用 R type-7 线性插值，4 个样本不能可靠估计 P90。nativeReady=仅 native 的 3 个 ready 运行（run1 blocked 单列，避免把 blocked 耗时混入有效运行估计）。',
    native: summarizeRows('native', timings.runs.filter((row) => row.arm === 'native')),
    nativeReady: summarizeRows('native-ready', timings.runs.filter((row) => row.arm === 'native' && row.state === 'ready')),
    off: summarizeRows('off', timings.runs.filter((row) => row.arm === 'off')),
    all: summarizeAll(timings.runs),
  }

  const usageSummary = {
    note: 'off 组 4 个 run 的实例 DSH_HOME（/tmp/hephi-off-b5）已被清理，仓库证据不含 usage/token；按任务要求写 unknown/null，不补 0。',
    native: usage,
    off: Object.keys(OFF_TICKET_RUN).map((file) => ({ arm: 'off', sourceFile: `eval/evidence/b5off/${file}`, available: false, usage: null, reason: 'off 实例 session/usage 未保留（实例已清理，off-host.log 无 usage）' })),
  }
  const nativeTotals = usage.filter((row) => row.available).map((row) => row.usage)
  usageSummary.nativeAggregate = {
    runsAvailable: nativeTotals.length,
    totalTokensSum: sum(nativeTotals.map((row) => row.totalTokens)),
    nonCacheInputOutputSum: sum(nativeTotals.map((row) => row.nonCacheInputOutput)),
    totalTokensMedian: percentile(nativeTotals.map((row) => row.totalTokens), 0.5),
    totalTokensP90: percentile(nativeTotals.map((row) => row.totalTokens), 0.9),
    nonCacheInputOutputMedian: percentile(nativeTotals.map((row) => row.nonCacheInputOutput), 0.5),
    nonCacheInputOutputP90: percentile(nativeTotals.map((row) => row.nonCacheInputOutput), 0.9),
  }

  const nativeUsageRows = usage.filter((row) => row.available)
  const cost = buildCost(timings, summaryOf(nativeUsageRows), usageSummary.off)

  const sample = grid()
  const write = (name, value) => writeFileSync(join(HERE, name), `${JSON.stringify(value, null, 2)}\n`)
  write('cost.json', cost)
  write('timings.json', timings)
  write('native-usage.json', usageSummary)
  write('native-tickets-raw.json', nativeRaw.map((row) => ({ id: row.ticketId, run: row.run, value: row })))
  write('sample-grid.json', sample)
  console.log(JSON.stringify({
    runs: timings.runs.map((row) => ({ arm: row.arm, run: row.run, state: row.state, durations: row.durations })),
    summary: timings.summary,
    usageAggregate: usageSummary.nativeAggregate,
    sample: { attempts: sample.attempts, valid: sample.valid, invalid: sample.invalid, range: sample.requiredPairsRange },
  }, null, 2))
}

function summarizeAll(runs) {
  const metric = (name) => ({
    median: percentile(runs.map((row) => row.durations[name]), 0.5),
    p90: percentile(runs.map((row) => row.durations[name]), 0.9),
    nulls: runs.filter((row) => row.durations[name] === null).map((row) => `${row.arm}/${row.run}`),
  })
  return { n: runs.length, workerSeconds: metric('workerSeconds'), endToEndSeconds: metric('endToEndSeconds') }
}

main()
