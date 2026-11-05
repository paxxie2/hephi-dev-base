import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ActivationContract } from './activation.js'
import { allowedPath } from './repository.js'

const exec = promisify(execFile)
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout

/** Project scope always applies; a task card narrows it to the union of its acceptance paths. */
export function inScope(contract: ActivationContract, file: string): boolean {
  if (!allowedPath(file, contract.allowedPaths)) return false
  return !contract.task || contract.task.acceptance.some(item => allowedPath(file, item.paths))
}

export type ChangeSummary = {
  files: string[]
  changedLines: number
  renames: Array<{ from: string; to: string }>
  deleted: string[]
  formatOnly: string[]
}

export async function summarizeChanges(workspace: string, baseSha: string): Promise<ChangeSummary> {
  const files = (await git(workspace, 'diff', '--name-only', '-z', '--no-renames', baseSha, '--')).split('\0').filter(Boolean)
  let changedLines = 0
  for (const line of (await git(workspace, 'diff', '--numstat', '-z', '--no-renames', baseSha, '--')).split('\0').filter(Boolean)) {
    const [added, removed] = line.split('\t')
    // Binary files report "-"; count each as one line so they still consume budget.
    changedLines += added === '-' ? 1 : Number(added) + Number(removed)
  }
  const renames: ChangeSummary['renames'] = []
  const statuses = (await git(workspace, 'diff', '--name-status', '-z', '-M', baseSha, '--')).split('\0')
  for (let i = 0; i < statuses.length - 1;) {
    const status = statuses[i]
    if (status.startsWith('R') || status.startsWith('C')) { renames.push({ from: statuses[i + 1], to: statuses[i + 2] }); i += 3 } else i += 2
  }
  const deleted = (await git(workspace, 'diff', '--name-only', '-z', '--no-renames', '--diff-filter=D', baseSha, '--')).split('\0').filter(Boolean)
  const formatOnly: string[] = []
  for (const file of files) {
    if (deleted.includes(file)) continue
    const semantic = await git(workspace, 'diff', '--no-renames', '-w', '--ignore-blank-lines', '--ignore-cr-at-eol', baseSha, '--', file)
    if (!semantic.trim()) formatOnly.push(file)
  }
  return { files, changedLines, renames, deleted, formatOnly }
}

const sample = (items: string[]) => items.slice(0, 10).join(', ') + (items.length > 10 ? ` (+${items.length - 10} more)` : '')

/**
 * Problems are phrased as the concrete correction the Worker should make,
 * because a denied ready report is the Worker's next instruction.
 */
export function disciplineProblems(contract: ActivationContract, changes: ChangeSummary): string[] {
  const problems: string[] = []
  const outside = changes.files.filter(file => !inScope(contract, file))
  if (outside.length) problems.push(`revert files outside the task scope: ${sample(outside)}`)
  const task = contract.task
  if (!task) return problems
  if (changes.files.length > task.budget.maxFiles) problems.push(`change touches ${changes.files.length} files, budget is ${task.budget.maxFiles}; revert changes the acceptance items do not need`)
  if (changes.changedLines > task.budget.maxChangedLines) problems.push(`change has ${changes.changedLines} changed lines, budget is ${task.budget.maxChangedLines}; revert refactoring and unrelated edits`)
  if (!task.allowRenames && changes.renames.length) problems.push(`renames/moves are not allowed by the task: ${sample(changes.renames.map(r => `${r.from} -> ${r.to}`))}`)
  if (!task.allowFormatOnly && changes.formatOnly.length) problems.push(`formatting-only changes are not allowed by the task: ${sample(changes.formatOnly)}`)
  const protectedDeleted = changes.deleted.filter(file => allowedPath(file, task.protect))
  if (protectedDeleted.length) problems.push(`existing tests must not be deleted: ${sample(protectedDeleted)}`)
  return problems
}

export async function checkDiscipline(contract: ActivationContract, workspace: string): Promise<ChangeSummary> {
  const changes = await summarizeChanges(workspace, contract.baseSha)
  const problems = disciplineProblems(contract, changes)
  if (problems.length) throw new Error(`HEPHI change discipline: ${problems.join('; ')}`)
  return changes
}
