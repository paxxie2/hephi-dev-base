#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVerificationConfig } from './contracts/checks.js'
import { taskCardSchema } from './contracts/task.js'
import { prepareActivation, defaultStateDir } from './control/activation.js'
import {
  OPERATOR_RESOLUTIONS_ENV, RESOLUTION_BASES, appendResolution, operatorResolutionsAllowed, readRun,
  type ResolutionBasis,
} from './control/check-store.js'

export type CliIo = { out(message: string): void; err(message: string): void }
const consoleIo: CliIo = { out: message => console.log(message), err: message => console.error(message) }

const RESOLUTION_STATUSES = ['running', 'terminated', 'unavailable'] as const
type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number]

export const USAGE = `usage: hephi prepare
       hephi resolve --ticket <id> --run <runId>
                     --basis <host-terminal|operator-risk-accepted>
                     --status <running|terminated|unavailable>
                     (--host-query <raw query output> | --host-query-file <path>)
                     --operator <name> [--accept-risk] [--state-dir <dir>]
       hephi stats [--state-dir <dir>] [--ticket <id>] [--rule <prefix>] [--json]
       hephi lint-task <task.json> [--json]

hephi stats reads (never writes) decision logs under <stateDir>/hephi/<ticketId>/decisions.jsonl.
With --ticket it summarizes one Ticket; without it scans every Ticket directory and prints a
per-Ticket table. Corrupt lines are counted and reported on stderr, never trusted. --json emits
machine-readable output; --rule filters by rule-number prefix.

hephi lint-task validates a task bundle offline (no network/git): task card (hephi-task JSON),
ticketId, allowedPaths and the project checks referenced by every acceptance item. It only reads
the given file; warnings (too many acceptance items, too-wide allowedPaths) do not fail the lint.

hephi resolve records an A3 operator resolution for one unresolved (running/unknown)
check execution. It only restores the right to run the check again; the resolved
execution stays non-passing evidence, and its run.json/output.log are never edited.

The command is disabled by default. The temporary switch is the host/operator
environment variable ${OPERATOR_RESOLUTIONS_ENV}=1; it must become the host config
field allowOperatorResolutions (cordis.patch.yml, read in apply(ctx, config)) so a
Worker cannot enable or invoke it from its own environment (A3 trust boundary, G1).

--status running      host still reports the execution: refuse to resolve.
--status terminated   host confirmed the execution ended (result lost): basis host-terminal.
--status unavailable  host query unavailable: requires --accept-risk and
                      --basis operator-risk-accepted.
--accept-risk         only valid with --basis operator-risk-accepted.`

class UsageError extends Error {}

function safeId(value: string, what: string): string {
  if (!/^[\w-]+$/.test(value)) throw new UsageError(`${what} is not a safe identifier: ${value}`)
  return value
}

function parseResolveArgs(args: string[]): {
  ticketId: string; runId: string; basis: ResolutionBasis; status: ResolutionStatus
  hostQuery?: string; hostQueryFile?: string; operator: string; acceptRisk: boolean; stateDir?: string
} {
  const values = new Map<string, string>()
  let acceptRisk = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--accept-risk') { acceptRisk = true; continue }
    if (arg === '--help' || arg === '-h') throw new UsageError('help')
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument: ${arg}`)
    if (values.has(arg)) throw new UsageError(`duplicate argument: ${arg}`)
    const value = args[index + 1]
    if (value === undefined) throw new UsageError(`missing value for ${arg}`)
    index += 1
    values.set(arg, value)
  }
  const allowed = new Set(['--ticket', '--run', '--basis', '--status', '--host-query', '--host-query-file', '--operator', '--state-dir'])
  for (const key of values.keys()) if (!allowed.has(key)) throw new UsageError(`unknown argument: ${key}`)
  const ticket = values.get('--ticket'), run = values.get('--run'), basis = values.get('--basis')
  const status = values.get('--status'), operator = values.get('--operator')
  if (ticket === undefined) throw new UsageError('--ticket is required')
  if (run === undefined) throw new UsageError('--run is required')
  if (basis === undefined) throw new UsageError('--basis is required')
  if (status === undefined) throw new UsageError('--status is required')
  if (operator === undefined) throw new UsageError('--operator is required')
  if (!RESOLUTION_BASES.includes(basis as ResolutionBasis)) throw new UsageError(`--basis must be one of: ${RESOLUTION_BASES.join(', ')}`)
  if (!(RESOLUTION_STATUSES as readonly string[]).includes(status)) throw new UsageError(`--status must be one of: ${RESOLUTION_STATUSES.join(', ')}`)
  const hostQuery = values.get('--host-query'), hostQueryFile = values.get('--host-query-file')
  if (hostQuery !== undefined && hostQueryFile !== undefined) throw new UsageError('set only one of --host-query and --host-query-file')
  if (hostQuery === undefined && hostQueryFile === undefined) throw new UsageError('one of --host-query and --host-query-file is required')
  const name = operator.trim()
  if (!name) throw new UsageError('--operator must not be empty')
  if (name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new UsageError('--operator must be a single-line value of at most 200 characters')
  if (hostQuery !== undefined && hostQuery.length > 100_000) throw new UsageError('--host-query is too long')
  const parsedBasis = basis as ResolutionBasis
  if (acceptRisk && parsedBasis !== 'operator-risk-accepted') throw new UsageError('--accept-risk is only accepted with --basis operator-risk-accepted')
  return {
    ticketId: safeId(ticket, '--ticket'), runId: safeId(run, '--run'), basis: parsedBasis,
    status: status as ResolutionStatus, hostQuery, hostQueryFile, operator: name, acceptRisk,
    stateDir: values.get('--state-dir'),
  }
}

async function resolveCommand(args: string[], env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  if (!operatorResolutionsAllowed(env)) {
    io.err(`operator resolutions are disabled: the host must set ${OPERATOR_RESOLUTIONS_ENV}=1 (future host config field allowOperatorResolutions); a Worker must not be able to enable this path`)
    return 1
  }
  let options: ReturnType<typeof parseResolveArgs>
  try { options = parseResolveArgs(args) } catch (error) {
    if (error instanceof UsageError && error.message === 'help') { io.out(USAGE); return 0 }
    io.err(error instanceof Error ? error.message : String(error))
    io.err(USAGE)
    return 2
  }
  if (options.status === 'running') {
    io.err('host still reports the check as running; stop it, confirm a terminal state and then resolve')
    return 1
  }
  if (options.basis === 'host-terminal' && options.status !== 'terminated') {
    io.err('--basis host-terminal requires --status terminated (a host query confirmed the end of the execution)')
    return 2
  }
  if (options.basis === 'operator-risk-accepted' && (options.status !== 'unavailable' || !options.acceptRisk)) {
    io.err('--basis operator-risk-accepted requires --status unavailable and --accept-risk (host query was not available)')
    return 2
  }
  let hostQuery: string
  try {
    hostQuery = options.hostQuery ?? await readFile(options.hostQueryFile!, 'utf8')
  } catch (error) {
    io.err(`cannot read --host-query-file: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  if (!hostQuery.trim()) { io.err('the host query evidence must not be empty'); return 2 }
  const stateDir = defaultStateDir(options.stateDir)
  try {
    const record = await readRun(stateDir, options.ticketId, options.runId)
    if (record.status !== 'running' && record.status !== 'unknown') {
      io.err(`check run ${options.runId} is already settled (status=${record.status}); operator resolution only applies to running/unknown executions`)
      return 1
    }
    const result = await appendResolution(stateDir, {
      ticketId: options.ticketId, contractHash: record.contractHash, runId: options.runId,
      basis: options.basis, hostQuery, operator: options.operator,
    })
    if (result.appended) {
      io.out(`HEPHI resolution recorded: ticket=${options.ticketId} run=${options.runId} basis=${options.basis} operator=${options.operator}`)
    } else {
      io.out(`HEPHI resolution already recorded: ticket=${options.ticketId} run=${options.runId} (idempotent, no new record)`)
    }
    return 0
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  }
}

// ---- stats (C4.9)：只读汇总决策日志，不写任何文件 -------------------------

const STATS_USAGE = `usage: hephi stats [--state-dir <dir>] [--ticket <id>] [--rule <prefix>] [--json]`

const DECISION_MODES = ['enforce', 'shadow'] as const
const DECISION_VALUES = ['allow', 'deny'] as const
type DecisionMode = (typeof DECISION_MODES)[number]
type DecisionValue = (typeof DECISION_VALUES)[number]

type DecisionEntry = {
  seq: number
  at: string
  rule: string
  mode: DecisionMode
  effectiveDecision: DecisionValue
  wouldDecision: DecisionValue
}

type TicketStats = {
  ticketId: string
  entries: number
  matched: number
  corruptLines: number
  rules: Record<string, number>
  modes: Record<DecisionMode, number>
  effectiveDecision: Record<DecisionValue, number>
  earliest: string | null
  latest: string | null
}

type StatsTotals = Omit<TicketStats, 'ticketId'> & { tickets: number; skippedTickets: number }

const SAFE_TICKET_ID = /^[A-Za-z0-9._-]+$/
const CORRUPT_WARNINGS_PER_TICKET = 3

function emptyTicketStats(ticketId: string): TicketStats {
  return {
    ticketId, entries: 0, matched: 0, corruptLines: 0, rules: {},
    modes: { enforce: 0, shadow: 0 }, effectiveDecision: { allow: 0, deny: 0 },
    earliest: null, latest: null,
  }
}

function emptyStatsTotals(): StatsTotals {
  return {
    tickets: 0, entries: 0, matched: 0, corruptLines: 0, rules: {},
    modes: { enforce: 0, shadow: 0 }, effectiveDecision: { allow: 0, deny: 0 },
    earliest: null, latest: null, skippedTickets: 0,
  }
}

function decisionEntry(value: unknown): { entry: DecisionEntry } | { reason: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { reason: 'not a JSON object' }
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) <= 0) return { reason: 'missing or invalid seq' }
  if (typeof record.at !== 'string' || record.at.length === 0 || Number.isNaN(Date.parse(record.at))) {
    return { reason: 'missing or invalid at timestamp' }
  }
  if (typeof record.rule !== 'string' || record.rule.trim().length === 0) return { reason: 'missing or invalid rule' }
  if (!(DECISION_MODES as readonly unknown[]).includes(record.mode)) return { reason: 'missing or invalid mode' }
  if (!(DECISION_VALUES as readonly unknown[]).includes(record.effectiveDecision)) {
    return { reason: 'missing or invalid effectiveDecision' }
  }
  if (!(DECISION_VALUES as readonly unknown[]).includes(record.wouldDecision)) {
    return { reason: 'missing or invalid wouldDecision' }
  }
  return {
    entry: {
      seq: record.seq as number,
      at: record.at,
      rule: record.rule,
      mode: record.mode as DecisionMode,
      effectiveDecision: record.effectiveDecision as DecisionValue,
      wouldDecision: record.wouldDecision as DecisionValue,
    },
  }
}

function addEntry(stats: TicketStats | StatsTotals, entry: DecisionEntry): void {
  stats.matched += 1
  stats.rules[entry.rule] = (stats.rules[entry.rule] ?? 0) + 1
  stats.modes[entry.mode] += 1
  stats.effectiveDecision[entry.effectiveDecision] += 1
  const time = Date.parse(entry.at)
  if (stats.earliest === null || time < Date.parse(stats.earliest)) stats.earliest = entry.at
  if (stats.latest === null || time > Date.parse(stats.latest)) stats.latest = entry.at
}

function mergeTotals(target: StatsTotals, ticket: TicketStats): void {
  target.tickets += 1
  target.entries += ticket.entries
  target.matched += ticket.matched
  target.corruptLines += ticket.corruptLines
  for (const [rule, count] of Object.entries(ticket.rules)) target.rules[rule] = (target.rules[rule] ?? 0) + count
  for (const mode of DECISION_MODES) target.modes[mode] += ticket.modes[mode]
  for (const value of DECISION_VALUES) target.effectiveDecision[value] += ticket.effectiveDecision[value]
  if (ticket.earliest !== null && (target.earliest === null || Date.parse(ticket.earliest) < Date.parse(target.earliest))) {
    target.earliest = ticket.earliest
  }
  if (ticket.latest !== null && (target.latest === null || Date.parse(ticket.latest) > Date.parse(target.latest))) {
    target.latest = ticket.latest
  }
}

async function summarizeDecisionLog(
  stateDir: string, ticketId: string, rulePrefix: string | null, io: CliIo,
): Promise<{ stats: TicketStats; missing: boolean }> {
  const stats = emptyTicketStats(ticketId)
  let text: string
  try {
    text = await readFile(join(stateDir, 'hephi', ticketId, 'decisions.jsonl'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { stats, missing: true }
    throw error
  }
  const lines = text.split('\n')
  let warned = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    stats.entries += 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      stats.corruptLines += 1
      warned += 1
      if (warned <= CORRUPT_WARNINGS_PER_TICKET) {
        io.err(`[stats] ${ticketId}: corrupt decisions.jsonl line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    const result = decisionEntry(parsed)
    if ('reason' in result) {
      stats.corruptLines += 1
      warned += 1
      if (warned <= CORRUPT_WARNINGS_PER_TICKET) {
        io.err(`[stats] ${ticketId}: corrupt decisions.jsonl line ${index + 1}: ${result.reason}`)
      }
      continue
    }
    if (rulePrefix !== null && !result.entry.rule.startsWith(rulePrefix)) continue
    addEntry(stats, result.entry)
  }
  if (stats.corruptLines > CORRUPT_WARNINGS_PER_TICKET) {
    io.err(`[stats] ${ticketId}: ${stats.corruptLines} corrupt lines in total (showing first ${CORRUPT_WARNINGS_PER_TICKET})`)
  }
  return { stats, missing: false }
}

function sortRules(rules: Record<string, number>): Array<[string, number]> {
  return Object.entries(rules).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function formatTicketStats(stats: TicketStats, rulePrefix: string | null): string {
  const lines = [
    `HEPHI stats — ticket ${stats.ticketId}`,
    `  entries=${stats.entries} matched=${stats.matched} corrupt=${stats.corruptLines}` +
      (rulePrefix === null ? '' : ` rulePrefix=${rulePrefix}`),
    `  mode: enforce=${stats.modes.enforce} shadow=${stats.modes.shadow}`,
    `  effectiveDecision: allow=${stats.effectiveDecision.allow} deny=${stats.effectiveDecision.deny}`,
    `  earliest=${stats.earliest ?? 'none'} latest=${stats.latest ?? 'none'}`,
    '  rules:',
    ...sortRules(stats.rules).map(([rule, count]) => `    ${rule.padEnd(32)} ${count}`),
  ]
  if (Object.keys(stats.rules).length === 0) lines.push('    (none)')
  return lines.join('\n')
}

function formatAllStats(tickets: TicketStats[], totals: StatsTotals, rulePrefix: string | null): string {
  const lines = [
    `HEPHI stats — tickets=${totals.tickets} entries=${totals.entries} matched=${totals.matched} corrupt=${totals.corruptLines} skipped=${totals.skippedTickets}` +
      (rulePrefix === null ? '' : ` rulePrefix=${rulePrefix}`),
    '',
    'ticket                          entries  matched  corrupt  earliest                  latest',
  ]
  for (const ticket of tickets) {
    lines.push(`${ticket.ticketId.padEnd(30)}  ${String(ticket.entries).padStart(7)}  ${String(ticket.matched).padStart(7)}  ${String(ticket.corruptLines).padStart(7)}  ${(ticket.earliest ?? 'none').padEnd(24)}  ${ticket.latest ?? 'none'}`)
  }
  if (tickets.length === 0) lines.push('(no decision logs)')
  lines.push('', `mode: enforce=${totals.modes.enforce} shadow=${totals.modes.shadow}`)
  lines.push(`effectiveDecision: allow=${totals.effectiveDecision.allow} deny=${totals.effectiveDecision.deny}`)
  lines.push(`earliest=${totals.earliest ?? 'none'} latest=${totals.latest ?? 'none'}`, 'rules:')
  const rules = sortRules(totals.rules)
  if (rules.length === 0) lines.push('  (none)')
  for (const [rule, count] of rules) lines.push(`  ${rule.padEnd(32)} ${count}`)
  return lines.join('\n')
}

function parseStatsArgs(args: string[]): { stateDir?: string; ticket?: string; rule?: string; json: boolean } {
  let stateDir: string | undefined
  let ticket: string | undefined
  let rule: string | undefined
  let json = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--json') { json = true; continue }
    if (arg === '--help' || arg === '-h') throw new UsageError('help')
    if (arg === '--state-dir' || arg === '--ticket' || arg === '--rule') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`missing value for ${arg}`)
      index += 1
      if (arg === '--state-dir') { if (stateDir !== undefined) throw new UsageError('duplicate argument: --state-dir'); stateDir = value }
      else if (arg === '--ticket') { if (ticket !== undefined) throw new UsageError('duplicate argument: --ticket'); ticket = value }
      else { if (rule !== undefined) throw new UsageError('duplicate argument: --rule'); rule = value }
      continue
    }
    throw new UsageError(`unknown argument: ${arg}`)
  }
  if (ticket !== undefined && !SAFE_TICKET_ID.test(ticket)) throw new UsageError(`--ticket is not a safe identifier: ${ticket}`)
  if (rule !== undefined && rule.length === 0) throw new UsageError('--rule prefix must not be empty')
  return { stateDir, ticket, rule, json }
}

async function statsCommand(args: string[], env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  let options: ReturnType<typeof parseStatsArgs>
  try {
    options = parseStatsArgs(args)
  } catch (error) {
    if (error instanceof UsageError && error.message === 'help') { io.out(STATS_USAGE); return 0 }
    io.err(error instanceof Error ? error.message : String(error))
    io.err(STATS_USAGE)
    return 2
  }
  const stateDir = defaultStateDir(options.stateDir)
  const rulePrefix = options.rule ?? null
  const tickets: TicketStats[] = []
  let skippedTickets = 0
  try {
    if (options.ticket !== undefined) {
      const result = await summarizeDecisionLog(stateDir, options.ticket, rulePrefix, io)
      tickets.push(result.stats)
    } else {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(join(stateDir, 'hephi'), { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        entries = []
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!SAFE_TICKET_ID.test(entry.name)) {
          skippedTickets += 1
          io.err(`[stats] skipped unsafe ticket directory name: ${JSON.stringify(entry.name)}`)
          continue
        }
        const result = await summarizeDecisionLog(stateDir, entry.name, rulePrefix, io)
        if (result.missing) continue
        tickets.push(result.stats)
      }
      tickets.sort((a, b) => a.ticketId.localeCompare(b.ticketId))
    }
  } catch (error) {
    io.err(`[stats] cannot read decision logs: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const totals = emptyStatsTotals()
  totals.skippedTickets = skippedTickets
  for (const ticket of tickets) mergeTotals(totals, ticket)

  if (options.json) {
    const payload = {
      schemaVersion: 1,
      filter: { rulePrefix },
      tickets,
      totals: {
        tickets: totals.tickets, entries: totals.entries, matched: totals.matched,
        corruptLines: totals.corruptLines, skippedTickets: totals.skippedTickets,
        modes: totals.modes, effectiveDecision: totals.effectiveDecision, rules: totals.rules,
        earliest: totals.earliest, latest: totals.latest,
      },
    }
    io.out(JSON.stringify(payload, null, 2))
    return 0
  }
  io.out(options.ticket === undefined ? formatAllStats(tickets, totals, rulePrefix) : formatTicketStats(tickets[0]!, rulePrefix))
  return 0
}

// ---- lint-task (C5)：离线校验任务卡 bundle，不依赖网络/git ------------------

const LINT_TASK_USAGE = `usage: hephi lint-task <task.json> [--json]

输入是任务 bundle（JSON）：task（hephi-task 任务卡）、ticketId、allowedPaths、
checks（或 verification.checks）。也可以把任务卡字段平铺在顶层，与 ticketId/allowedPaths/checks 并列。`

const TASK_CARD_KEYS = ['version', 'goal', 'outOfScope', 'acceptance', 'budget', 'protect'] as const
const LINT_BUNDLE_KEYS = new Set([
  ...TASK_CARD_KEYS, 'task', 'ticketId', 'allowedPaths', 'checks', 'verification',
])

function formatZodIssues(error: unknown): string[] {
  if (error !== null && typeof error === 'object' && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path?: Array<string | number | symbol>; message?: string }> }).issues
    return issues.map(issue => `${(issue.path ?? []).map(String).join('.') || '<root>'}: ${issue.message ?? 'invalid'}`)
  }
  return [error instanceof Error ? error.message : String(error)]
}

function safeRelativeGlob(value: string): boolean {
  if (value.length === 0 || value.includes('\0')) return false
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false
  if (value.split(/[\\/]+/).includes('..')) return false
  const normal = normalize(value)
  return normal !== '..' && !normal.startsWith(`..${sep}`) && !normal.startsWith('../')
}

function parseLintArgs(args: string[]): { file: string; json: boolean } {
  let file: string | undefined
  let json = false
  for (const arg of args) {
    if (arg === '--json') { json = true; continue }
    if (arg === '--help' || arg === '-h') throw new UsageError('help')
    if (arg.startsWith('-')) throw new UsageError(`unknown argument: ${arg}`)
    if (file !== undefined) throw new UsageError(`unexpected argument: ${arg}`)
    file = arg
  }
  if (file === undefined) throw new UsageError('missing <task.json>')
  return { file, json }
}

async function lintTaskCommand(args: string[], io: CliIo): Promise<number> {
  let options: ReturnType<typeof parseLintArgs>
  try {
    options = parseLintArgs(args)
  } catch (error) {
    if (error instanceof UsageError && error.message === 'help') { io.out(LINT_TASK_USAGE); return 0 }
    io.err(error instanceof Error ? error.message : String(error))
    io.err(LINT_TASK_USAGE)
    return 2
  }
  const errors: string[] = []
  const warnings: string[] = []
  let raw: string
  try {
    raw = await readFile(options.file, 'utf8')
  } catch (error) {
    io.err(`HEPHI task lint: FAIL ${options.file}`)
    io.err(`  - cannot read file: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    io.err(`HEPHI task lint: FAIL ${options.file}`)
    io.err(`  - not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    io.err(`HEPHI task lint: FAIL ${options.file}`)
    io.err('  - top-level value must be a JSON object')
    return 1
  }
  const record = parsed as Record<string, unknown>
  const bundleChecks = record.checks ?? (record.verification !== null && typeof record.verification === 'object'
    ? (record.verification as Record<string, unknown>).checks
    : undefined)

  let taskInput: unknown
  if (record.task !== undefined) {
    if (record.task === null || typeof record.task !== 'object' || Array.isArray(record.task)) {
      errors.push('task must be an object')
    } else {
      taskInput = record.task
    }
  } else {
    taskInput = Object.fromEntries(TASK_CARD_KEYS.filter(key => key in record).map(key => [key, record[key]]))
  }
  for (const key of Object.keys(record)) {
    if (!LINT_BUNDLE_KEYS.has(key)) warnings.push(`unknown top-level field ignored: ${key}`)
  }

  let card: { acceptance: Array<{ id: string; check: string }> } | null = null
  const cardResult = taskCardSchema.safeParse(taskInput)
  if (!cardResult.success) errors.push(...formatZodIssues(cardResult.error))
  else card = cardResult.data

  let verification: ReturnType<typeof parseVerificationConfig> | null = null
  if (!Array.isArray(bundleChecks) || bundleChecks.length === 0) {
    errors.push('checks must be a non-empty array (or verification.checks); acceptance items reference these checks')
  } else {
    try {
      verification = parseVerificationConfig({ version: 1, checks: bundleChecks })
    } catch (error) {
      errors.push(...formatZodIssues(error))
    }
  }

  const ticketId = record.ticketId
  if (typeof ticketId !== 'string' || !SAFE_TICKET_ID.test(ticketId)) {
    errors.push('ticketId must be a non-empty safe identifier ([A-Za-z0-9._-])')
  }
  const allowedPaths = record.allowedPaths
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    errors.push('allowedPaths must be a non-empty array of workspace-relative globs')
  } else {
    for (const [index, path] of allowedPaths.entries()) {
      if (typeof path !== 'string' || !safeRelativeGlob(path)) {
        errors.push(`allowedPaths[${index}] must be a workspace-relative glob without absolute or escaping paths: ${String(path)}`)
      }
    }
    if (allowedPaths.length > 50) warnings.push(`allowedPaths has ${allowedPaths.length} entries (>50): scope may be too wide`)
  }

  if (card !== null && verification !== null) {
    const byId = new Map(verification.checks.map(check => [check.id, check]))
    for (const item of card.acceptance) {
      const check = byId.get(item.check)
      if (check === undefined) {
        errors.push(`acceptance ${item.id} references unknown check: ${item.check}`)
      } else if (check.kind !== 'test') {
        errors.push(`acceptance ${item.id} must reference a test check, not ${check.kind} check ${check.id}`)
      }
    }
    if (card.acceptance.length > 8) warnings.push(`task card has ${card.acceptance.length} acceptance items (>8): consider splitting the Issue`)
  }

  const summary = {
    acceptance: card?.acceptance.length ?? 0,
    checks: verification?.checks.length ?? 0,
    allowedPaths: Array.isArray(allowedPaths) ? allowedPaths.length : 0,
  }
  if (options.json) {
    io.out(JSON.stringify({
      schemaVersion: 1, ok: errors.length === 0, file: options.file,
      errors, warnings, summary,
    }, null, 2))
    return errors.length === 0 ? 0 : 1
  }
  if (errors.length > 0) {
    io.err(`HEPHI task lint: FAIL ${options.file}`)
    for (const error of errors) io.err(`  - ${error}`)
    for (const warning of warnings) io.err(`  WARN: ${warning}`)
    return 1
  }
  io.out(`HEPHI task lint: PASS ${options.file} (acceptance=${summary.acceptance} checks=${summary.checks} allowedPaths=${summary.allowedPaths})`)
  for (const warning of warnings) io.err(`HEPHI task lint: WARN ${warning}`)
  return 0
}

/** CLI entry point. Returns the process exit code instead of calling process.exit, so tests can drive it. */
export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = consoleIo,
): Promise<number> {
  const command = argv[0]
  if (command === 'stats') return statsCommand(argv.slice(1), env, io)
  if (command === 'lint-task') return lintTaskCommand(argv.slice(1), io)
  if (command === 'prepare') {
    try {
      const result = await prepareActivation(env)
      if (result.enabled) io.out(`HEPHI activation written to ${result.filePath}`)
      return 0
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error))
      return 1
    }
  }
  if (command === 'resolve') return resolveCommand(argv.slice(1), env, io)
  io.err(USAGE)
  return 2
}

function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try { return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (invokedAsCli()) process.exitCode = await main()
