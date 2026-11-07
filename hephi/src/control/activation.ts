import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseVerificationConfig, type VerificationConfig } from '../contracts/checks.js'
import { parseIssueTask, parseTaskCard, type TaskCard } from '../contracts/task.js'
import { pluginCommit, pluginVersion } from '../version.js'

export type ExecutionMode = 'native' | 'staged'

/** shadow only observes: decisions are recorded but never enforced. */
export type EnforcementMode = 'enforce' | 'shadow'

/** The format this plugin writes. Older formats are read-only compatible; unknown versions are rejected. */
export const ACTIVATION_VERSION = 2

/** Contract formats written before canonical hashing. Their stored hash uses the raw JSON key order. */
export const LEGACY_ACTIVATION_VERSION = 1

export type ActivationContract = {
  /** Format version. Absent only in contracts written before versioning (legacy). */
  version?: number
  enabled: true
  ticketId: string
  repository: string
  issueNumber: number
  workspace: string
  baseRef: string
  baseSha: string
  allowedPaths: string[]
  requirePullRequest: boolean
  /** Absent only in contracts written before execution modes. It then means native. */
  executionMode?: ExecutionMode
  /** Absent only in contracts written before shadow mode. It then means enforce. */
  enforcement?: EnforcementMode
  /** Frozen checks are required for every activation. */
  verification: VerificationConfig
  /** Plugin build that froze this contract. Absent only in contracts written before P2. */
  plugin?: { version: string; commit: string }
  /** Issue-scoped task card. Absent only in contracts written before task cards. */
  task?: TaskCard
  contractHash: string
}

/** The hash payload of a contract exactly as it was written. Old contracts lack executionMode. */
type ContractHashInput = Omit<ActivationContract, 'contractHash' | 'executionMode'> & { executionMode?: unknown }

export type ActivationResult =
  | { enabled: false; reason: 'not-requested' }
  | { enabled: true; filePath: string; contract: ActivationContract }

const DEFAULT_STATE_DIR = join(homedir(), '.dsh-superagent')

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`${key} is required when HEPHI_ENABLED=1`)
  return value
}

function positiveInteger(value: string, key: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${key} must be a positive integer`)
  return number
}

function safeTicketId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('DSH_SUPERAGENT_TICKET contains unsafe path characters')
  return value
}

function list(value: string | undefined): string[] {
  if (!value?.trim()) throw new Error('HEPHI_ALLOWED_PATHS is required when HEPHI_ENABLED=1')
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string' && item.trim())) {
      return parsed.map(item => item.trim())
    }
  } catch {
    // Allow the simple comma-separated form for shell configuration.
  }
  const result = value.split(',').map(item => item.trim()).filter(Boolean)
  if (!result.length) throw new Error('HEPHI_ALLOWED_PATHS must contain at least one path')
  return result
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  throw new Error(`invalid boolean value: ${value}`)
}

/** Environment default is native; an explicitly invalid value must never silently fall back. */
export function parseExecutionMode(value: string | undefined): ExecutionMode {
  const mode = value?.trim()
  if (!mode) return 'native'
  if (mode === 'native' || mode === 'staged') return mode
  throw new Error(`HEPHI_EXECUTION_MODE must be "native" or "staged", got "${value}"`)
}

/** Environment default is enforce; an explicitly invalid value must never silently fall back. */
export function parseEnforcement(value: string | undefined): EnforcementMode {
  const mode = value?.trim()
  if (!mode) return 'enforce'
  if (mode === 'enforce' || mode === 'shadow') return mode
  throw new Error(`HEPHI_ENFORCEMENT must be "enforce" or "shadow", got "${value}"`)
}

/** Validate a persisted mode only after the contract hash has been checked. */
function contractEnforcement(value: unknown): EnforcementMode {
  if (value === undefined) return 'enforce'
  if (value === 'enforce' || value === 'shadow') return value
  throw new Error(`HEPHI activation contract has invalid enforcement: ${String(value)}`)
}

/** Historical contracts without enforcement mean enforce. */
export function enforcementOf(contract: ActivationContract): EnforcementMode {
  return contractEnforcement(contract.enforcement)
}

/** Validate a persisted mode only after the contract hash has been checked. */
function contractExecutionMode(value: unknown): ExecutionMode {
  if (value === undefined) return 'native'
  if (value === 'native' || value === 'staged') return value
  throw new Error(`HEPHI activation contract has invalid executionMode: ${String(value)}`)
}

/** Historical contracts without a mode keep their original hash and mean native. */
export function executionModeOf(contract: ActivationContract): ExecutionMode {
  return contractExecutionMode(contract.executionMode)
}

/** Validate the one supported check contract. No legacy fallback. */
export function verificationOf(contract: ActivationContract): VerificationConfig {
  return parseVerificationConfig(contract.verification)
}

async function loadVerificationFromEnv(env: NodeJS.ProcessEnv): Promise<VerificationConfig> {
  const file = env.HEPHI_VERIFICATION_FILE?.trim()
  const inline = env.HEPHI_VERIFICATION_CHECKS?.trim()
  if (file && inline) throw new Error('Set only one of HEPHI_VERIFICATION_FILE and HEPHI_VERIFICATION_CHECKS')
  if (!file && !inline) {
    throw new Error('HEPHI_VERIFICATION_FILE or HEPHI_VERIFICATION_CHECKS is required when HEPHI_ENABLED=1; a new activation contract must freeze explicit project checks')
  }
  let raw: unknown
  try {
    raw = JSON.parse(file ? await readFile(file, 'utf8') : inline!)
  } catch (error) {
    throw new Error(`HEPHI verification configuration is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseVerificationConfig(raw)
}

const ISSUE_MODE = /\[\s*(native|staged)\s*\]/gi

/**
 * Issue mode is a host-owned marker, never a model guess. Exactly one distinct
 * [native]/[staged] marker is required; a conflicting explicit env mode rejects.
 */
export function parseIssueExecutionMode(title: string | undefined, explicit?: string): ExecutionMode {
  if (!title?.trim()) throw new Error('Issue title must contain an explicit [native] or [staged] execution mode marker')
  const modes = [...new Set([...title.matchAll(ISSUE_MODE)].map(match => match[1].toLowerCase()))] as ExecutionMode[]
  if (modes.length === 0) throw new Error('Issue title must contain an explicit [native] or [staged] execution mode marker')
  if (modes.length > 1) throw new Error('Issue title contains conflicting [native] and [staged] execution mode markers')
  const mode = modes[0]
  if (explicit !== undefined && explicit.trim()) {
    const explicitMode = parseExecutionMode(explicit)
    if (explicitMode !== mode) throw new Error(`HEPHI_EXECUTION_MODE (${explicitMode}) conflicts with the Issue marker (${mode})`)
  }
  return mode
}

/**
 * Recursively sort object keys (UTF-16 code unit order); arrays keep their order.
 * JSON semantics are preserved: undefined object values are dropped, undefined
 * array items become null, no Unicode normalization and no number formatting change.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonicalize(item))
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const item = source[key]
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue
      out[key] = canonicalize(item)
    }
    return out
  }
  return value
}

/** Canonical payload for the current format (version 2): sorted keys, arrays in order, no whitespace. */
export function canonicalPayload(contract: ContractHashInput): string {
  return JSON.stringify(canonicalize(contract))
}

/** Historical payload for version 1 / unversioned contracts: raw JSON.stringify key order, never rewritten. */
export function legacyPayload(contract: ContractHashInput): string {
  return JSON.stringify(contract)
}

/** Current contract hash (version 2, canonical serialization). */
export function contractHash(contract: ContractHashInput): string {
  return `sha256:${createHash('sha256').update(canonicalPayload(contract)).digest('hex')}`
}

/** Historical contract hash for version 1 / unversioned contracts. Read-only compatibility. */
export function legacyContractHash(contract: ContractHashInput): string {
  return `sha256:${createHash('sha256').update(legacyPayload(contract)).digest('hex')}`
}

export function activationPath(stateDir: string, ticketId: string): string {
  return join(stateDir, 'hephi', safeTicketId(ticketId), 'activation.json')
}

export function activationIntentPath(stateDir: string, ticketId: string): string {
  return join(stateDir, 'hephi', safeTicketId(ticketId), 'activation.intent')
}

function taskOf(env: NodeJS.ProcessEnv, verification: VerificationConfig): TaskCard | undefined {
  const body = env.HEPHI_ISSUE_BODY
  const card = body === undefined ? undefined : parseIssueTask(body)
  if (!card) {
    if (boolean(env.HEPHI_REQUIRE_TASK, false)) throw new Error('Issue body must contain a hephi-task block when HEPHI_REQUIRE_TASK=1')
    return undefined
  }
  for (const item of card.acceptance) {
    const check = verification.checks.find(c => c.id === item.check)
    if (!check) throw new Error(`acceptance ${item.id} refers to unknown check ${item.check}`)
    if (check.kind !== 'test') throw new Error(`acceptance ${item.id} must name a behaviour test check, not ${check.kind} check ${check.id}`)
  }
  return card
}

/**
 * An intent is deliberately a marker, not a second contract. Unknown access
 * errors count as present so an activated task cannot silently become normal.
 */
export function activationIntentPresentSync(filePath: string): boolean {
  try {
    statSync(filePath)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/** Create the marker for older activations that predate activation.intent. */
export function migrateActivationIntentSync(stateDir: string, ticketId: string): void {
  const intentPath = activationIntentPath(stateDir, ticketId)
  if (activationIntentPresentSync(intentPath)) return
  if (!activationIntentPresentSync(activationPath(stateDir, ticketId))) return
  mkdirSync(dirname(intentPath), { recursive: true })
  try {
    writeFileSync(intentPath, `${ticketId}\n`, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export function defaultStateDir(configured?: string): string {
  return configured?.trim() || process.env.HEPHI_STATE_DIR?.trim() || DEFAULT_STATE_DIR
}

export async function prepareActivation(env: NodeJS.ProcessEnv = process.env): Promise<ActivationResult> {
  if (env.HEPHI_ENABLED !== '1') return { enabled: false, reason: 'not-requested' }

  // Reject an invalid mode before writing an intent or a partial contract.
  const enforcement = parseEnforcement(env.HEPHI_ENFORCEMENT)
  const executionMode = env.HEPHI_ISSUE_TITLE !== undefined
    ? parseIssueExecutionMode(env.HEPHI_ISSUE_TITLE, env.HEPHI_EXECUTION_MODE)
    : parseExecutionMode(env.HEPHI_EXECUTION_MODE)
  const ticketId = safeTicketId(required(env, 'DSH_SUPERAGENT_TICKET'))
  const stateDir = env.HEPHI_STATE_DIR?.trim() || DEFAULT_STATE_DIR
  const intentPath = activationIntentPath(stateDir, ticketId)
  await mkdir(dirname(intentPath), { recursive: true })
  try {
    await writeFile(intentPath, `${ticketId}\n`, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const verification = await loadVerificationFromEnv(env)
  const task = taskOf(env, verification)
  const base: Omit<ActivationContract, 'contractHash'> = {
    version: ACTIVATION_VERSION,
    enabled: true,
    ticketId,
    repository: required(env, 'DSH_SUPERAGENT_GITHUB_REPOSITORY'),
    issueNumber: positiveInteger(required(env, 'DSH_SUPERAGENT_GITHUB_NUMBER'), 'DSH_SUPERAGENT_GITHUB_NUMBER'),
    workspace: required(env, 'DSH_SUPERAGENT_DIR'),
    baseRef: env.HEPHI_BASE_REF?.trim() || 'main',
    baseSha: required(env, 'HEPHI_BASE_COMMIT'),
    allowedPaths: list(env.HEPHI_ALLOWED_PATHS),
    requirePullRequest: boolean(env.HEPHI_REQUIRE_PULL_REQUEST, false),
    executionMode,
    enforcement,
    plugin: { version: pluginVersion, commit: pluginCommit() },
    verification,
    ...(task ? { task } : {}),
  }
  const contract: ActivationContract = { ...base, contractHash: contractHash(base) }
  const filePath = activationPath(stateDir, ticketId)
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, filePath)
  return { enabled: true, filePath, contract }
}

function isContract(value: unknown): value is Omit<ActivationContract, 'executionMode'> & { executionMode?: unknown } {
  if (!value || typeof value !== 'object') return false
  const contract = value as Partial<ActivationContract>
  return contract.enabled === true
    && typeof contract.ticketId === 'string'
    && typeof contract.repository === 'string'
    && Number.isInteger(contract.issueNumber) && (contract.issueNumber ?? 0) > 0
    && typeof contract.workspace === 'string'
    && typeof contract.baseRef === 'string' && contract.baseRef.length > 0
    && typeof contract.baseSha === 'string' && contract.baseSha.length > 0
    && Array.isArray(contract.allowedPaths) && contract.allowedPaths.every(item => typeof item === 'string')
    && typeof contract.requirePullRequest === 'boolean'
    && typeof contract.contractHash === 'string'
}

const ACTIVATION_FIELDS = new Set([
  'version', 'enabled', 'ticketId', 'repository', 'issueNumber', 'workspace', 'baseRef', 'baseSha',
  'allowedPaths', 'requirePullRequest', 'executionMode', 'enforcement', 'plugin', 'verification', 'task', 'contractHash',
])

/** An unknown top-level field could change a decision in a newer writer; it must not be ignored. */
function rejectUnsupportedFields(parsed: Record<string, unknown>, filePath: string): void {
  for (const key of Object.keys(parsed)) {
    if (!ACTIVATION_FIELDS.has(key)) throw new Error(`unsupported HEPHI activation field: ${key} (${filePath})`)
  }
}

/**
 * Current format is 2. Version 1 and contracts without a version stay readable.
 * Anything else is rejected with an explicit migration instruction.
 */
function supportedVersion(value: unknown, filePath: string): void {
  if (value === undefined || value === LEGACY_ACTIVATION_VERSION || value === ACTIVATION_VERSION) return
  throw new Error(`unsupported HEPHI activation version: ${String(value)}; re-prepare a new contract with the current plugin instead of editing the stored hash (${filePath})`)
}

/**
 * Parse one activation contract. The stored hash is verified against the raw
 * object first, so old contracts keep their original hash and mode-less meaning;
 * only then is executionMode interpreted. Nothing is rewritten or re-hashed.
 */
function parseActivation(text: string, filePath: string): ActivationContract {
  const parsed: unknown = JSON.parse(text)
  if (!isContract(parsed)) throw new Error(`invalid HEPHI activation contract: ${filePath}`)
  const { contractHash: storedHash, ...base } = parsed
  // Version selects the hash algorithm. Version 2 uses canonical serialization;
  // version 1 and unversioned contracts keep the historical raw key-order hash.
  // Unknown versions are checked with the historical algorithm first so a forged
  // hash still reports as a hash mismatch rather than a supported-but-wrong version.
  const expectedHash = base.version === ACTIVATION_VERSION ? contractHash(base) : legacyContractHash(base)
  if (storedHash !== expectedHash) throw new Error(`HEPHI activation contract hash mismatch: ${filePath}`)
  supportedVersion(base.version, filePath)
  rejectUnsupportedFields(parsed as Record<string, unknown>, filePath)
  // Validate persisted optional fields only after the original hash matches.
  // Return the parsed object unchanged so historical contracts keep their raw
  // shape and later reads/hashes match.
  contractExecutionMode(base.executionMode)
  contractEnforcement(base.enforcement)
  if (base.plugin !== undefined) {
    const plugin = base.plugin as { version?: unknown; commit?: unknown }
    if (typeof plugin?.version !== 'string' || typeof plugin?.commit !== 'string') throw new Error(`invalid HEPHI activation plugin metadata: ${filePath}`)
  }
  const verification = parseVerificationConfig(base.verification)
  if (base.task !== undefined) {
    const task = parseTaskCard(base.task)
    for (const item of task.acceptance) {
      if (!verification.checks.some(check => check.id === item.check)) throw new Error(`HEPHI activation contract acceptance ${item.id} refers to unknown check ${item.check}`)
    }
  }
  return parsed as ActivationContract
}

export function loadActivationSync(filePath: string): ActivationContract {
  return parseActivation(readFileSync(filePath, 'utf8'), filePath)
}

export async function loadActivation(filePath: string): Promise<ActivationContract> {
  return parseActivation(await readFile(filePath, 'utf8'), filePath)
}

export async function activationExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
