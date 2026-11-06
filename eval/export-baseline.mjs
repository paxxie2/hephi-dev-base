#!/usr/bin/env node
// P15 历史基线保全：从原生 Ticket 主表（orchestrator sqlite）导出不可变归档。
// 只读打开数据库（immutable=1），不写库；PR 关联为启发式提取，缺失如实记录，不补造工单。
// 用法：node eval/export-baseline.mjs --db <sqlite> [--db <sqlite> ...] --out <new-dir> [--window <fromISO>..<toISO>]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const dbs = []
process.argv.forEach((value, i) => {
  if (value === '--db') dbs.push(process.argv[i + 1])
})
const out = arg('out')
const window = arg('window', null)
if (dbs.length === 0 || !out) {
  console.error('usage: node eval/export-baseline.mjs --db <sqlite> [--db ...] --out <dir> [--window from..to]')
  process.exit(2)
}
if (existsSync(out) && readdirSync(out).length > 0) {
  console.error(`out 目录必须为空或不存在：${out}`)
  process.exit(2)
}

const [from, to] = window ? window.split('..') : [null, null]

function readTickets(db) {
  if (!existsSync(db)) throw new Error(`db 不存在：${db}`)
  const text = execFileSync('sqlite3', ['-json', `file:${db}?immutable=1`, 'select id, value from ticket;'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return JSON.parse(text || '[]')
}

function normalize(db, row) {
  const ticket = JSON.parse(row.value)
  const prRefs = [...new Set(row.value.match(/https:\/\/github\.com\/[^"\\\s]+\/pull\/\d+/g) ?? [])]
  const ended = ticket.ended && typeof ticket.ended === 'object' ? ticket.ended : null
  return {
    id: ticket.id ?? row.id,
    title: ticket.title ?? '',
    createdAt: ticket.createdAt ?? null,
    updatedAt: ticket.updatedAt ?? null,
    ended: ended ? { at: ended.at ?? null, by: ended.by ?? null, outcome: ended.outcome ?? null } : null,
    status: ended?.outcome ?? 'open',
    prRefs,
    assignmentCount: Array.isArray(ticket.assignments) ? ticket.assignments.length : 0,
    source: db,
  }
}

const tickets = []
const sources = []
for (const db of dbs) {
  let rows
  try { rows = readTickets(db) }
  catch (error) { console.error(`读取数据库失败：${db}（${error instanceof Error ? error.message : String(error)}）`); process.exit(2) }
  const normalized = rows.map((row) => normalize(db, row))
    .filter((ticket) => (!from || (ticket.createdAt ?? '') >= from) && (!to || (ticket.createdAt ?? '') <= to))
  tickets.push(...normalized)
  sources.push({ db, tickets: normalized.length })
}

const ids = new Set(tickets.map((ticket) => ticket.id))
const summary = {
  generator: 'eval/export-baseline.mjs',
  exportedAt: new Date().toISOString(),
  window: window ?? null,
  sources,
  total: tickets.length,
  uniqueIds: ids.size,
  duplicates: tickets.length - ids.size,
  prLinked: tickets.filter((ticket) => ticket.prRefs.length > 0).length,
  noPr: tickets.filter((ticket) => ticket.prRefs.length === 0).length,
  byStatus: tickets.reduce((acc, ticket) => ({ ...acc, [ticket.status]: (acc[ticket.status] ?? 0) + 1 }), {}),
  unknownCount: tickets.filter((ticket) => !['merged', 'stopped', 'dropped', 'completed', 'open'].includes(ticket.status)).length,
  notes: [
    'PR 关联为 JSON 中 https://github.com/<owner>/<repo>/pull/<n> 的启发式提取，不保证覆盖所有人工记录。',
    '无 ended 记录的 Ticket 计为 status=open，不自动归为 off。',
  ],
}

mkdirSync(out, { recursive: true })
const ticketsJson = `${JSON.stringify(tickets, null, 2)}\n`
const summaryJson = `${JSON.stringify(summary, null, 2)}\n`
writeFileSync(join(out, 'tickets.json'), ticketsJson)
writeFileSync(join(out, 'summary.json'), summaryJson)
const sums = [['tickets.json', ticketsJson], ['summary.json', summaryJson]]
  .map(([name, body]) => `${createHash('sha256').update(body).digest('hex')}  ${name}`)
  .join('\n')
writeFileSync(join(out, 'SHA256SUMS'), `${sums}\n`)
console.log(JSON.stringify({ out, ...summary, sources: undefined }, null, 2))
