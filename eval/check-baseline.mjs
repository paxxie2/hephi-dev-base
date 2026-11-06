#!/usr/bin/env node
// P15 归档校验：重算归档内容与 summary 是否一致，校验 SHA256、唯一 ID、终态分类。
// 只读归档目录，不修改；失败时退出码 1，缺文件退出码 2。
// 用法：node eval/check-baseline.mjs --archive <dir>
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const archive = arg('archive')
if (!archive) {
  console.error('usage: node eval/check-baseline.mjs --archive <dir>')
  process.exit(2)
}

const problems = []
function read(name) {
  const path = join(archive, name)
  if (!existsSync(path)) {
    problems.push(`缺少 ${name}`)
    return null
  }
  return readFileSync(path, 'utf8')
}

const ticketsText = read('tickets.json')
const summaryText = read('summary.json')
const sumsText = read('SHA256SUMS')
if (ticketsText === null || summaryText === null || sumsText === null) {
  console.error(problems.join('\n'))
  process.exit(2)
}

// 归档可包含额外文件（如 pr-metadata.json）：逐个校验 SHA256SUMS 列出的文件。
for (const line of sumsText.trim().split('\n').filter(Boolean)) {
  const [hash, name] = line.trim().split(/\s+/)
  if (!name) { problems.push('SHA256SUMS 存在空行'); continue }
  const file = join(archive, name)
  if (!existsSync(file)) { problems.push(`SHA256SUMS 列出但缺少文件 ${name}`); continue }
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash) problems.push(`${name} SHA256 不符`)
}

const tickets = JSON.parse(ticketsText)
const summary = JSON.parse(summaryText)
const ids = new Set(tickets.map((ticket) => ticket.id))
if (tickets.length !== summary.total) problems.push(`total 不符：tickets=${tickets.length} summary=${summary.total}`)
if (ids.size !== summary.uniqueIds) problems.push(`uniqueIds 不符：实际=${ids.size} summary=${summary.uniqueIds}`)

const byStatus = {}
let unknown = 0
for (const ticket of tickets) {
  if (!ticket.id) problems.push('存在无 id 的 Ticket')
  const known = ['merged', 'stopped', 'dropped', 'completed', 'open']
  if (ticket.status === 'off') problems.push(`unknown 不得自动归为 off：${ticket.id}`)
  if (ticket.ended == null && ticket.status !== 'open') problems.push(`无 ended 但 status!=open：${ticket.id}`)
  if (!known.includes(ticket.status)) unknown += 1
  if (!Array.isArray(ticket.prRefs)) problems.push(`prRefs 非数组：${ticket.id}`)
  byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1
}
for (const [status, count] of Object.entries(summary.byStatus ?? {})) {
  if ((byStatus[status] ?? 0) !== count) problems.push(`byStatus[${status}] 不符：实际=${byStatus[status] ?? 0} summary=${count}`)
}
const prLinked = tickets.filter((ticket) => ticket.prRefs.length > 0).length
if (prLinked !== summary.prLinked) problems.push(`prLinked 不符：实际=${prLinked} summary=${summary.prLinked}`)
if (unknown !== summary.unknownCount) problems.push(`unknownCount 不符：实际=${unknown} summary=${summary.unknownCount}`)

const result = { archive, total: tickets.length, uniqueIds: ids.size, byStatus, unknown, prLinked, ok: problems.length === 0, problems }
console.log(JSON.stringify(result, null, 2))
process.exit(problems.length === 0 ? 0 : 1)
