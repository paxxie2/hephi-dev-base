import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * Issue-scoped task card. It is written by the Issue author inside a fenced
 * ```hephi-task``` block and frozen into the activation contract by prepare.
 *
 * Every changed file must belong to some acceptance item's `paths`; each item
 * is proven by a frozen test (supplied in the Issue, never in the Worker's
 * checkout) and/or Worker tests matched by `tests`, which must pass on HEAD
 * and fail on the base commit.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const relative = z.string().min(1).refine(v => !v.startsWith('/') && !v.split(/[\\/]+/).includes('..') && !v.includes('\0'), 'must be a relative path inside the repository')

const frozenTestSchema = z.object({ path: relative, sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict()

const acceptanceSchema = z.object({
  id: z.string().regex(ID),
  text: z.string().trim().min(1),
  check: z.string().regex(ID),
  paths: z.array(relative).min(1),
  tests: z.array(relative).default([]),
  frozen: z.array(frozenTestSchema).default([]),
}).strict().refine(a => a.tests.length > 0 || a.frozen.length > 0, 'each acceptance item needs frozen tests or Worker test globs')

export const DEFAULT_PROTECTED = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*Test.java', '**/*_test.go', '**/test_*.py']

export const taskCardSchema = z.object({
  version: z.literal(1),
  goal: z.string().trim().min(1),
  outOfScope: z.array(z.string().trim().min(1)).default([]),
  acceptance: z.array(acceptanceSchema).min(1),
  budget: z.object({
    maxFiles: z.number().int().min(1).max(200),
    maxChangedLines: z.number().int().min(1).max(20000),
  }).strict(),
  allowRenames: z.boolean().default(false),
  allowFormatOnly: z.boolean().default(false),
  protect: z.array(relative).default(DEFAULT_PROTECTED),
}).strict().superRefine((card, ctx) => {
  const ids = new Set<string>()
  for (const a of card.acceptance) {
    if (ids.has(a.id)) ctx.addIssue({ code: 'custom', message: `duplicate acceptance id: ${a.id}` })
    ids.add(a.id)
  }
})

export type TaskCard = z.infer<typeof taskCardSchema>
export type AcceptanceItem = TaskCard['acceptance'][number]

export function parseTaskCard(input: unknown): TaskCard {
  return taskCardSchema.parse(input)
}

const FENCE = /^(`{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm

export type IssueTask = { card: TaskCard; frozenFiles: Map<string, { acceptanceId: string; content: string }> }

/**
 * Extract the task card and its frozen tests from an Issue body.
 *
 * ```hephi-task            -> JSON card; `frozen` entries are filled in here
 * ```hephi-test AC1 path   -> frozen test content for acceptance item AC1
 */
export function parseIssueTask(body: string): IssueTask | undefined {
  let raw: string | undefined
  const tests: Array<{ acceptanceId: string; path: string; content: string }> = []
  for (const match of body.replace(/\r\n/g, '\n').matchAll(FENCE)) {
    const info = match[2].trim().split(/\s+/)
    if (info[0] === 'hephi-task') {
      if (raw !== undefined) throw new Error('Issue contains more than one hephi-task block')
      raw = match[3]
    } else if (info[0] === 'hephi-test') {
      if (info.length !== 3) throw new Error('hephi-test block must be written as: hephi-test <acceptanceId> <relative path>')
      tests.push({ acceptanceId: info[1], path: info[2], content: `${match[3]}\n` })
    }
  }
  if (raw === undefined) {
    if (tests.length) throw new Error('hephi-test blocks require a hephi-task block')
    return undefined
  }
  let parsed: any
  try { parsed = JSON.parse(raw) } catch (error) { throw new Error(`hephi-task block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.acceptance)) throw new Error('hephi-task block must contain an acceptance array')
  if (parsed.acceptance.some((a: any) => a && 'frozen' in a)) throw new Error('frozen tests are declared only through hephi-test blocks')
  const frozenFiles = new Map<string, { acceptanceId: string; content: string }>()
  for (const test of tests) {
    const item = parsed.acceptance.find((a: any) => a?.id === test.acceptanceId)
    if (!item) throw new Error(`hephi-test refers to unknown acceptance item ${test.acceptanceId}`)
    if (frozenFiles.has(test.path)) throw new Error(`duplicate frozen test path: ${test.path}`)
    item.frozen = [...(item.frozen ?? []), { path: test.path, sha256: `sha256:${createHash('sha256').update(test.content).digest('hex')}` }]
    frozenFiles.set(test.path, { acceptanceId: test.acceptanceId, content: test.content })
  }
  return { card: parseTaskCard(parsed), frozenFiles }
}
