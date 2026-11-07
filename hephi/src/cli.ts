#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

/** CLI entry point. Returns the process exit code instead of calling process.exit, so tests can drive it. */
export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = consoleIo,
): Promise<number> {
  const command = argv[0]
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
