#!/usr/bin/env node
// B8 daily-use exporter: archive ALL tickets (merged / unmerged / dropped / long-blocked).
//
// ROADMAP-95 §B8: 日常使用统计必须覆盖所有工单（已合并、未合并、被放弃、长期阻塞），
// 不能只数已合并的工单。本脚本是 P15 基线归档（eval/export-baseline.mjs）的“日常导出”
// 补充：输入可以是 P15 归档目录，也可以是任意同形 JSON；输出统一字段 + 计数。
//
//   node eval/daily/export.mjs --input <archive.json|dir> --out <json>
//   node eval/daily/export.mjs --self-test
//
// 去重键：ticketId（P15 用 Ticket 主表 id -> 这里映射为 ticketId；P15 summary 的
// `uniqueIds` 与本脚本的 total 同口径，见 eval/daily/MAINTENANCE.md §2）。
//
// 计数口径（见 MAINTENANCE.md，计划审查 P2-6 要求写清去重键与状态映射）：
//   total    = 去重后的工单数（所有状态）
//   merged   = 有合并证据的工单（P15 outcome=merged / merged* 字段 / PR merged 标记）
//   unmerged = total - merged（未合并；包含 dropped/blocked/open，故与下面两个计数有重叠）
//   dropped  = 明确被放弃的工单（P15 outcome=dropped / dropped/abandoned 标记）
//   blocked  = 当前仍处于阻塞的工单（blocked 标记 / blockedSince；P15 open 且无阻塞字段时计 0）
//   另外给出互斥拆分 merged/droppedOnly/blockedOnly/closedUnmerged/openNotBlocked，便于核对：
//   total = merged + closedUnmerged + droppedOnly + blockedOnly + openNotBlocked。
//
// 只读输入；不访问网络、不修改归档。输出到 --out 指定的新 JSON 文件。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export class UsageError extends Error {}

const MERGE_EVIDENCE = new Set(['merged'])
const DROPPED_EVIDENCE = new Set(['dropped', 'abandoned', 'cancelled', 'canceled'])
const CLOSED_EVIDENCE = new Set(['completed', 'stopped', 'closed', 'done'])

function firstDefined(...values) { return values.find(value => value !== undefined && value !== null) }

function safeId(value) {
  if (value === undefined || value === null) return null
  const id = String(value).trim()
  return id ? id : null
}

/** Accept P15 `prRefs` (strings), plain numbers, or objects with number/url/merged. */
export function normalizePrRefs(raw) {
  const list = []
  const push = value => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) { for (const item of value) push(item); return }
    if (typeof value === 'number' || typeof value === 'string') {
      const text = String(value).trim()
      if (!text) return
      const number = /(\d+)\s*$/.exec(text.split('pull/').pop() ?? '')?.[1]
      list.push({ ref: text, number: number ? Number(number) : null, merged: false })
      return
    }
    if (typeof value === 'object') {
      const number = Number.isSafeInteger(value.number) ? value.number : null
      const ref = typeof value.url === 'string' ? value.url : (number ? `#${number}` : null)
      if (ref === null) return
      list.push({ ref, number, merged: value.merged === true || value.state === 'merged' })
    }
  }
  push(raw)
  const seen = new Set()
  return list.filter(item => { if (seen.has(item.ref)) return false; seen.add(item.ref); return true })
}

/** Normalize one raw ticket. Returns null when there is no usable ticketId. */
export function normalizeTicket(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const ticketId = safeId(firstDefined(raw.ticketId, raw.id, raw.ticket))
  if (!ticketId) return null
  const ended = raw.ended && typeof raw.ended === 'object' ? raw.ended : null
  const statusRaw = firstDefined(raw.state, raw.status, raw.stage, ended?.outcome) ?? null
  const status = typeof statusRaw === 'string' ? statusRaw.toLowerCase() : null
  const prs = normalizePrRefs(firstDefined(raw.prs, raw.prRefs, raw.pullRequests, raw.pullRequest, raw.pr))
  const merged = raw.merged === true || typeof raw.mergedAt === 'string' || typeof raw.mergeCommit === 'string'
    || (status !== null && MERGE_EVIDENCE.has(status)) || prs.some(pr => pr.merged === true)
  const dropped = raw.dropped === true || raw.abandoned === true || (status !== null && DROPPED_EVIDENCE.has(status))
  const closed = Boolean(ended) || typeof firstDefined(raw.endedAt, raw.closedAt, raw.finishedAt) === 'string'
    || (status !== null && (DROPPED_EVIDENCE.has(status) || CLOSED_EVIDENCE.has(status) || MERGE_EVIDENCE.has(status)))
  const blocked = dropped ? false : (raw.blocked === true || typeof raw.blockedSince === 'string'
    || (typeof raw.blockedReason === 'string' && raw.blockedReason.trim() !== ''))
  return {
    ticketId,
    state: typeof firstDefined(raw.state, raw.status, ended?.outcome) === 'string' ? String(firstDefined(raw.state, raw.status, ended?.outcome)) : (closed ? 'ended' : 'open'),
    stage: firstDefined(raw.stage, raw.stageName) ?? null,
    status: status,
    createdAt: firstDefined(raw.createdAt, raw.created, raw.openedAt) ?? null,
    endedAt: firstDefined(raw.endedAt, raw.closedAt, raw.finishedAt, ended?.at) ?? null,
    updatedAt: firstDefined(raw.updatedAt, raw.updated) ?? null,
    prs,
    merged: Boolean(merged),
    dropped: Boolean(dropped),
    blocked: Boolean(blocked),
    closed,
    sourceIssue: firstDefined(raw.sourceIssue, raw.issue, raw.issueRef, raw.triggerIssue, raw.githubIssue) ?? null,
    source: firstDefined(raw.source, source) ?? null,
  }
}

/**
 * Deduplicate by ticketId. A later duplicate can only ADD evidence (never remove it),
 * so the merged/dropped/blocked booleans are OR-ed and other fields keep the first value.
 */
export function dedupeTickets(tickets) {
  const byId = new Map()
  for (const ticket of tickets) {
    const previous = byId.get(ticket.ticketId)
    if (!previous) { byId.set(ticket.ticketId, { ...ticket }); continue }
    byId.set(ticket.ticketId, {
      ...previous,
      merged: previous.merged || ticket.merged,
      dropped: previous.dropped || ticket.dropped,
      blocked: previous.blocked || ticket.blocked,
      closed: previous.closed || ticket.closed,
      prs: previous.prs.length ? previous.prs : ticket.prs,
      createdAt: previous.createdAt ?? ticket.createdAt,
      endedAt: previous.endedAt ?? ticket.endedAt,
      updatedAt: previous.updatedAt ?? ticket.updatedAt,
      sourceIssue: previous.sourceIssue ?? ticket.sourceIssue,
      stage: previous.stage ?? ticket.stage,
      status: previous.status ?? ticket.status,
      state: previous.state || ticket.state,
    })
  }
  return [...byId.values()]
}

export function summarize(tickets) {
  const total = tickets.length
  const merged = tickets.filter(ticket => ticket.merged).length
  const dropped = tickets.filter(ticket => !ticket.merged && ticket.dropped).length
  const blocked = tickets.filter(ticket => !ticket.merged && !ticket.dropped && ticket.blocked).length
  const closedUnmerged = tickets.filter(ticket => !ticket.merged && !ticket.dropped && !ticket.blocked && ticket.closed).length
  const openNotBlocked = total - merged - dropped - blocked - closedUnmerged
  return {
    total,
    merged,
    unmerged: total - merged,
    dropped,
    blocked,
    closedUnmerged,
    openNotBlocked,
    // Mutually exclusive split; identity: total === merged + dropped + blocked + closedUnmerged + openNotBlocked.
    withMergeEvidence: merged,
    prLinked: tickets.filter(ticket => ticket.prs.length > 0).length,
    byStatus: tickets.reduce((acc, ticket) => {
      const key = ticket.status ?? 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
  }
}

function readJsonFile(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (error) {
    throw new UsageError(`cannot read --input file ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try { return JSON.parse(text) } catch (error) {
    throw new UsageError(`--input file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Load tickets from a P15 archive directory or an archive-shaped JSON file. */
export function loadInput(inputPath) {
  const absolute = resolve(inputPath)
  if (!existsSync(absolute)) throw new UsageError(`--input does not exist: ${absolute}`)
  const isDirectory = statSync(absolute).isDirectory()
  let source
  let raw
  let summary = null
  if (isDirectory) {
    source = `${absolute}/tickets.json`
    raw = readJsonFile(join(absolute, 'tickets.json'))
    if (existsSync(join(absolute, 'summary.json'))) summary = readJsonFile(join(absolute, 'summary.json'))
  } else {
    source = absolute
    raw = readJsonFile(absolute)
  }
  const list = Array.isArray(raw) ? raw
    : (raw && Array.isArray(raw.tickets)) ? raw.tickets
      : (raw && raw.tickets && typeof raw.tickets === 'object' && !Array.isArray(raw.tickets)) ? Object.values(raw.tickets)
        : null
  if (list === null) throw new UsageError(`--input has no tickets array: ${absolute}`)
  const normalized = []
  let skippedInvalid = 0
  for (const entry of list) {
    const ticket = normalizeTicket(entry, source)
    if (ticket === null) { skippedInvalid += 1; continue }
    normalized.push(ticket)
  }
  if (normalized.length === 0) throw new UsageError(`--input contains no tickets with a ticketId: ${absolute}`)
  return { source, summary, tickets: dedupeTickets(normalized), skippedInvalid }
}

export function exportDaily(inputPath, { now = new Date().toISOString() } = {}) {
  const loaded = loadInput(inputPath)
  const counts = summarize(loaded.tickets)
  return {
    generator: 'eval/daily/export.mjs',
    schemaVersion: 1,
    exportedAt: now,
    input: loaded.source,
    inputSummary: loaded.summary === null ? null : {
      total: loaded.summary.total ?? null,
      uniqueIds: loaded.summary.uniqueIds ?? null,
      byStatus: loaded.summary.byStatus ?? null,
    },
    dedupKey: 'ticketId',
    skippedInvalid: loaded.skippedInvalid,
    counts,
    tickets: loaded.tickets,
  }
}

// ---------------------------------------------------------------------------
// Self-test: synthetic archive in a temp dir, all states + a duplicate ticket.
// ---------------------------------------------------------------------------
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
  const root = mkdtempSync(join(tmpdir(), 'daily-export-self-'))
  const archive = join(root, 'archive')
  const outPath = join(root, 'daily.json')
  try {
    mkdirSync(archive, { recursive: true })
    const tickets = [
      { id: 't-merged', title: 'merged', createdAt: '2026-01-01T00:00:00Z', ended: { at: '2026-01-02T00:00:00Z', outcome: 'merged' }, prRefs: ['https://github.com/example/repo/pull/1'] },
      { id: 't-open-blocked', title: 'blocked', createdAt: '2026-01-03T00:00:00Z', blockedSince: '2026-01-04T00:00:00Z', blockedReason: 'waits for upstream' },
      { id: 't-dropped', title: 'dropped', createdAt: '2026-01-05T00:00:00Z', ended: { at: '2026-01-06T00:00:00Z', outcome: 'dropped' } },
      { id: 't-open', title: 'open', createdAt: '2026-01-07T00:00:00Z' },
      { id: 't-closed', title: 'completed but not merged', createdAt: '2026-01-08T00:00:00Z', ended: { at: '2026-01-09T00:00:00Z', outcome: 'completed' } },
      { id: 't-evidence', title: 'merged flag only', createdAt: '2026-01-10T00:00:00Z', merged: true, prs: [{ url: 'https://github.com/example/repo/pull/9', state: 'merged' }] },
      { id: 't-merged', title: 'duplicate of merged', createdAt: '2026-01-01T00:00:00Z', merged: true, ended: { at: '2026-01-02T00:00:00Z', outcome: 'merged' } },
    ]
    writeFileSync(join(archive, 'tickets.json'), JSON.stringify(tickets, null, 2))
    writeFileSync(join(archive, 'summary.json'), JSON.stringify({ total: tickets.length, uniqueIds: 6, byStatus: { merged: 2, open: 2, dropped: 1, completed: 1 } }, null, 2))

    const result = exportDaily(archive, { now: '2026-11-07T00:00:00.000Z' })
    pass(results, 'self-test dedup key is ticketId', result.dedupKey === 'ticketId' && result.tickets.length === 6, `tickets=${result.tickets.length}`)
    pass(results, 'self-test total counts unique tickets', result.counts.total === 6, `total=${result.counts.total}`)
    pass(results, 'self-test merged count', result.counts.merged === 2, `merged=${result.counts.merged}`)
    pass(results, 'self-test unmerged is total - merged', result.counts.unmerged === 4 && result.counts.unmerged === result.counts.total - result.counts.merged, JSON.stringify(result.counts))
    pass(results, 'self-test dropped count', result.counts.dropped === 1, `dropped=${result.counts.dropped}`)
    pass(results, 'self-test blocked count', result.counts.blocked === 1, `blocked=${result.counts.blocked}`)
    pass(results, 'self-test mutually exclusive split sums to total', result.counts.merged + result.counts.dropped + result.counts.blocked + result.counts.closedUnmerged + result.counts.openNotBlocked === result.counts.total, JSON.stringify(result.counts))
    pass(results, 'self-test duplicate ticket can only add merge evidence', result.tickets.find(ticket => ticket.ticketId === 't-merged').merged === true)
    pass(results, 'self-test fields present per ticket', result.tickets.every(ticket => typeof ticket.ticketId === 'string' && 'state' in ticket && 'createdAt' in ticket && 'endedAt' in ticket && Array.isArray(ticket.prs) && 'merged' in ticket && 'dropped' in ticket && 'blocked' in ticket && 'sourceIssue' in ticket))
    pass(results, 'self-test PR merged flag counts as merge evidence', result.tickets.find(ticket => ticket.ticketId === 't-evidence').merged === true)
    pass(results, 'self-test input summary kept for P15 mapping', result.inputSummary && result.inputSummary.uniqueIds === 6)

    // CLI: missing args / nonexistent input exit 2; valid dir input writes JSON; JSON file input works.
    pass(results, 'self-test CLI rejects missing --input with exit 2', spawnCli(['--out', outPath]).status === 2)
    pass(results, 'self-test CLI rejects missing --out with exit 2', spawnCli(['--input', archive]).status === 2)
    pass(results, 'self-test CLI rejects nonexistent input with exit 2', spawnCli(['--input', join(root, 'missing'), '--out', outPath]).status === 2)
    const cliRun = spawnCli(['--input', archive, '--out', outPath])
    pass(results, 'self-test CLI exports archive directory', cliRun.status === 0 && JSON.parse(readFileSync(outPath, 'utf8')).counts.total === 6)
    const jsonInput = join(root, 'tickets.json')
    writeFileSync(jsonInput, JSON.stringify([{ ticketId: 'j-1', state: 'open' }, { ticketId: 'j-2', state: 'dropped', dropped: true }]))
    const jsonOut = join(root, 'json-out.json')
    const jsonRun = spawnCli(['--input', jsonInput, '--out', jsonOut])
    pass(results, 'self-test CLI exports plain JSON array input', jsonRun.status === 0 && JSON.parse(readFileSync(jsonOut, 'utf8')).counts.total === 2)
    pass(results, 'self-test CLI rejects invalid ticket input with exit 2', spawnCli(['--input', (() => { const p = join(root, 'bad.json'); writeFileSync(p, JSON.stringify([{ title: 'no id' }])); return p })(), '--out', join(root, 'x.json')]).status === 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  for (const line of results) console.log(line)
  const failed = results.filter(line => line.startsWith('FAIL')).length
  if (failed > 0) { console.log(`\nFAILED: ${failed} assertion(s)`); return 1 }
  console.log(`\nPASS: ${results.length} assertions (export self-test)`)
  return 0
}

function parseArgs(argv) {
  const options = { input: null, out: null, selfTest: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') { options.selfTest = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (!['--input', '--out'].includes(arg)) throw new UsageError(`unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new UsageError(`missing value for ${arg}`)
    index += 1
    if (arg === '--input') options.input = value
    if (arg === '--out') options.out = value
  }
  if (options.selfTest || options.help) return options
  if (options.input === null) throw new UsageError('--input is required')
  if (options.out === null) throw new UsageError('--out is required')
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('usage: node eval/daily/export.mjs --input <archive.json|dir> --out <json> | --self-test')
    process.exitCode = 2
  }
  if (options && options.help) { console.log('usage: node eval/daily/export.mjs --input <archive.json|dir> --out <json> | --self-test'); process.exitCode = 0 }
  else if (options && options.selfTest) process.exitCode = selfTest()
  else if (options) {
    try {
      const result = exportDaily(options.input)
      mkdirSync(dirname(resolve(options.out)), { recursive: true })
      writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`)
      console.log(JSON.stringify({ out: options.out, dedupKey: result.dedupKey, counts: result.counts }, null, 2))
    } catch (error) {
      const usage = error instanceof UsageError
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = usage ? 2 : 1
    }
  }
}
