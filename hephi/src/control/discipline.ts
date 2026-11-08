import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AssetOp, TaskCard } from '../contracts/task.js'
import type { ActivationContract } from './activation.js'
import { allowedPath } from './repository.js'

const exec = promisify(execFile)
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout

/** Project scope always applies; a task card narrows it to the union of its acceptance paths. */
export function inScope(contract: ActivationContract, file: string): boolean {
  if (!allowedPath(file, contract.allowedPaths)) return false
  return !contract.task || contract.task.acceptance.some(item => allowedPath(file, item.paths))
}

export type ChangeSummary = { files: string[]; changedLines: number; deleted: string[]; added: string[] }

export async function summarizeChanges(workspace: string, baseSha: string): Promise<ChangeSummary> {
  const files = (await git(workspace, 'diff', '--name-only', '-z', '--no-renames', baseSha, '--')).split('\0').filter(Boolean)
  let changedLines = 0
  for (const line of (await git(workspace, 'diff', '--numstat', '-z', '--no-renames', baseSha, '--')).split('\0').filter(Boolean)) {
    const [added, removed] = line.split('\t')
    // Binary files report "-"; count each as one line so they still consume a budget.
    changedLines += added === '-' ? 1 : Number(added) + Number(removed)
  }
  const deleted = (await git(workspace, 'diff', '--name-only', '-z', '--no-renames', '--diff-filter=D', baseSha, '--')).split('\0').filter(Boolean)
  const added = (await git(workspace, 'diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', baseSha, '--')).split('\0').filter(Boolean)
  return { files, changedLines, deleted, added }
}

// ---- C1 protected acceptance assets ----------------------------------------
//
// Effective protected list = project default (verification.protectedAssets) ∪ task card
// `protectedAssets`; the task card can only add, never shrink the project list.
// Priority (must be checked in this order, later rules never override earlier ones):
//   1. allowedPaths: an authorization never widens the contract scope;
//   2. the authorizing acceptance item's own `paths`;
//   3. exact acceptance item + exact file + exact operation (no cross-item/file/op inheritance);
//   4. unauthorized deletion of a protected asset is denied;
//   5. unauthorized modification/migration of a protected asset is denied;
//   6. modification of a non-protected existing test is record-only (`asset.modified`);
//   7. an authorization hit is recorded for audit (`asset.authorized`);
//   8. none of this changes ready/check semantics beyond those denials.
export type AssetAuthorization = { path: string; op: AssetOp }
export type AssetRecord = {
  rule: 'asset.authorized' | 'asset.modified'
  path: string
  op: 'modify' | 'delete'
  /** Acceptance item that authorized the change; absent for record-only asset.modified. */
  acceptance?: string
  detail: string
}

export function protectedAssetsOf(contract: ActivationContract): string[] {
  const project = contract.verification?.protectedAssets ?? []
  const task = contract.task?.protectedAssets ?? []
  return [...project, ...task]
}

export function isProtectedAsset(contract: ActivationContract, file: string): boolean {
  return allowedPath(file, protectedAssetsOf(contract))
}

/**
 * C1 authorization match. The file must be inside contract.allowedPaths and the
 * acceptance item's own `paths`; the authorization must live in that same item and name
 * exactly this file. `modify` never covers `delete`/`migrate` and `migrate` never covers
 * a plain `delete` (a migration needs a replacement file in the same diff).
 */
export function authorizedAcceptance(contract: ActivationContract, file: string, op: AssetOp): string | undefined {
  if (!allowedPath(file, contract.allowedPaths)) return undefined
  for (const item of contract.task?.acceptance ?? []) {
    if (!allowedPath(file, item.paths)) continue
    for (const authorization of item.authorizes ?? []) {
      if (authorization.path !== file) continue
      if (authorization.op !== op) continue
      return item.id
    }
  }
  return undefined
}

type DeletionAuthorization = { acceptance: string; kind: 'delete' } | { acceptance: string; kind: 'migrate'; replacement: string }

/**
 * A protected asset deletion is allowed by `delete`, or by `migrate` only when the
 * authorization's declared `replacement` is the exact file added by this change.
 */
function migrationAuthorization(contract: ActivationContract, file: string, changes: ChangeSummary): DeletionAuthorization | undefined {
  if (!allowedPath(file, contract.allowedPaths)) return undefined
  for (const item of contract.task?.acceptance ?? []) {
    if (!allowedPath(file, item.paths)) continue
    for (const authorization of item.authorizes ?? []) {
      if (authorization.path !== file || authorization.op !== 'migrate') continue
      const replacement = authorization.replacement
      if (replacement === undefined || replacement === file) continue
      if (!allowedPath(replacement, contract.allowedPaths) || !allowedPath(replacement, item.paths)) continue
      // The replacement must be the exact file this diff adds and must still exist at the end.
      if (!changes.added.includes(replacement) || changes.deleted.includes(replacement)) continue
      return { acceptance: item.id, kind: 'migrate', replacement }
    }
  }
  return undefined
}

function deletionAuthorization(contract: ActivationContract, file: string, changes: ChangeSummary): DeletionAuthorization | undefined {
  const deleted = authorizedAcceptance(contract, file, 'delete')
  if (deleted) return { acceptance: deleted, kind: 'delete' }
  return migrationAuthorization(contract, file, changes)
}

/** Why a declared migrate authorization is not effective; undefined when none is declared. */
function migrationProblem(contract: ActivationContract, file: string, changes: ChangeSummary): string | undefined {
  for (const item of contract.task?.acceptance ?? []) {
    for (const authorization of item.authorizes ?? []) {
      if (authorization.path !== file || authorization.op !== 'migrate') continue
      const replacement = authorization.replacement
      if (replacement === undefined) return 'no replacement is declared'
      if (replacement === file) return 'replacement equals the original path'
      if (!allowedPath(replacement, contract.allowedPaths)) return `replacement ${replacement} is outside contract allowedPaths`
      if (!allowedPath(replacement, item.paths)) return `replacement ${replacement} is outside the acceptance item paths`
      if (!changes.added.includes(replacement)) return `replacement ${replacement} was not added in this change`
      if (changes.deleted.includes(replacement)) return `replacement ${replacement} was added and then deleted in this change`
      return undefined
    }
  }
  return undefined
}

/** C1 protected-asset problems only (used by the ready-time shell-bypass recheck). */
export function assetProblems(contract: ActivationContract, changes: ChangeSummary): string[] {
  const problems: string[] = []
  const protectedFiles = protectedAssetsOf(contract)
  if (protectedFiles.length === 0) return problems
  const deleted = new Set(changes.deleted)
  const added = new Set(changes.added)
  for (const file of changes.files) {
    if (deleted.has(file) || added.has(file) || !allowedPath(file, protectedFiles)) continue
    if (!authorizedAcceptance(contract, file, 'modify')) {
      problems.push(`protected acceptance asset modified without authorization from its acceptance item: ${file}`)
    }
  }
  for (const file of changes.deleted) {
    if (!allowedPath(file, protectedFiles)) continue
    if (!deletionAuthorization(contract, file, changes)) {
      const migrate = migrationProblem(contract, file, changes)
      problems.push(`protected acceptance asset deleted without authorization from its acceptance item: ${file}${migrate === undefined ? '' : ` (migrate not established: ${migrate})`}`)
    }
  }
  return problems
}

/** C1 audit records: matching authorizations (`asset.authorized`) and record-only test edits (`asset.modified`). */
export function assetRecords(contract: ActivationContract, changes: ChangeSummary): AssetRecord[] {
  const records: AssetRecord[] = []
  const protectedFiles = protectedAssetsOf(contract)
  const task = contract.task
  const deleted = new Set(changes.deleted)
  const added = new Set(changes.added)
  for (const file of changes.files) {
    if (deleted.has(file) || added.has(file)) continue
    if (allowedPath(file, protectedFiles)) {
      const acceptance = authorizedAcceptance(contract, file, 'modify')
      if (acceptance) records.push({ rule: 'asset.authorized', path: file, op: 'modify', acceptance, detail: `${file} modified under authorization ${acceptance}` })
    } else if (task && allowedPath(file, task.protect)) {
      // Not a protected acceptance asset: the legacy protect list still blocks deletion, but a
      // modification is record-only (no deny) as required by C1.
      records.push({ rule: 'asset.modified', path: file, op: 'modify', detail: `${file} modified outside the protected asset list (record-only)` })
    }
  }
  for (const file of changes.deleted) {
    if (!allowedPath(file, protectedFiles)) continue
    const authorization = deletionAuthorization(contract, file, changes)
    if (!authorization) continue
    records.push({
      rule: 'asset.authorized', path: file, op: 'delete', acceptance: authorization.acceptance,
      detail: authorization.kind === 'migrate'
        ? `${file} deleted under migrate authorization ${authorization.acceptance} with replacement ${authorization.replacement}`
        : `${file} deleted under authorization ${authorization.acceptance}`,
    })
  }
  return records
}

/**
 * Contract-shape validation for C1 authorizations: an authorization may never widen
 * allowedPaths or the authorizing item's `paths`. Called by prepare and by contract load
 * (fail closed instead of silently ignoring an out-of-scope authorization).
 */
export function authorizationProblem(contract: { allowedPaths: string[]; task?: TaskCard }): string | undefined {
  for (const item of contract.task?.acceptance ?? []) {
    for (const authorization of item.authorizes ?? []) {
      if (!allowedPath(authorization.path, contract.allowedPaths)) {
        return `acceptance ${item.id} authorizes ${authorization.path}, which is outside contract allowedPaths`
      }
      if (!allowedPath(authorization.path, item.paths)) {
        return `acceptance ${item.id} authorizes ${authorization.path}, which is outside its own paths`
      }
      const replacement = authorization.replacement
      if (replacement === undefined) continue
      if (!allowedPath(replacement, contract.allowedPaths)) {
        return `acceptance ${item.id} replacement ${replacement}, which is outside contract allowedPaths`
      }
      if (!allowedPath(replacement, item.paths)) {
        return `acceptance ${item.id} replacement ${replacement}, which is outside its own paths`
      }
    }
  }
  return undefined
}

const sample = (items: string[]) => items.slice(0, 10).join(', ') + (items.length > 10 ? ` (+${items.length - 10} more)` : '')

/** Used only when the task card sets no budget. Recorded and shown; never a refusal. */
export const ADVISORY_BUDGET = { maxFiles: 8, maxChangedLines: 400 } as const

export function advisoryBudgetWarnings(contract: ActivationContract, changes: ChangeSummary): string[] {
  if (!contract.task || contract.task.budget) return []
  const warnings: string[] = []
  if (changes.files.length > ADVISORY_BUDGET.maxFiles) {
    warnings.push(`advisory budget: change touches ${changes.files.length} files, the default advisory limit is ${ADVISORY_BUDGET.maxFiles}; this is recorded and does not block delivery`)
  }
  if (changes.changedLines > ADVISORY_BUDGET.maxChangedLines) {
    warnings.push(`advisory budget: change has ${changes.changedLines} changed lines, the default advisory limit is ${ADVISORY_BUDGET.maxChangedLines}; this is recorded and does not block delivery`)
  }
  return warnings
}

/**
 * Mechanical limits only: paths, an explicitly requested budget, protected test deletion,
 * and the C1 protected acceptance assets. They do not detect semantic drift inside
 * allowed paths.
 */
export function disciplineProblems(contract: ActivationContract, changes: ChangeSummary): string[] {
  const problems: string[] = []
  const outside = changes.files.filter(file => !inScope(contract, file))
  if (outside.length) problems.push(`revert files outside the task scope: ${sample(outside)}`)
  const task = contract.task
  if (task) {
    const { maxFiles, maxChangedLines } = task.budget ?? {}
    if (maxFiles !== undefined && changes.files.length > maxFiles) problems.push(`change touches ${changes.files.length} files, the task budget is ${maxFiles}`)
    if (maxChangedLines !== undefined && changes.changedLines > maxChangedLines) problems.push(`change has ${changes.changedLines} changed lines, the task budget is ${maxChangedLines}`)
    // Existing-test deletion: keep the historical rule, but a protected asset deleted under
    // an explicit C1 authorization is handled by assetProblems (authorized deletion allowed).
    const protectedDeleted = changes.deleted.filter(file => allowedPath(file, task.protect) && !isProtectedAsset(contract, file))
    if (protectedDeleted.length) problems.push(`existing tests must not be deleted: ${sample(protectedDeleted)}`)
  }
  problems.push(...assetProblems(contract, changes))
  return problems
}

export async function checkDiscipline(contract: ActivationContract, workspace: string): Promise<ChangeSummary> {
  const changes = await summarizeChanges(workspace, contract.baseSha)
  const problems = disciplineProblems(contract, changes)
  if (problems.length) throw new Error(`HEPHI change discipline: ${problems.join('; ')}`)
  return changes
}

/**
 * Ready-time C1 recheck for paths that bypass the write/edit tools (shell writes, git
 * operations): recompute the final diff and return both the denials and the audit records.
 */
export async function assetReadyReport(contract: ActivationContract, workspace: string): Promise<{ changes: ChangeSummary; problems: string[]; records: AssetRecord[] }> {
  const changes = await summarizeChanges(workspace, contract.baseSha)
  return { changes, problems: assetProblems(contract, changes), records: assetRecords(contract, changes) }
}
