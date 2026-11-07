import { z } from 'zod'

/**
 * Issue-scoped task card, written by the Issue author inside a fenced
 * ```hephi-task``` block and frozen into the activation contract by prepare.
 *
 * Every changed file must belong to some acceptance item's `paths`. Each item
 * names the project check that demonstrates it; reproduction or behaviour
 * preservation is the project check's responsibility, not inferred here.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const relative = z.string().min(1).refine(v => !v.startsWith('/') && !v.split(/[\\/]+/).includes('..') && !v.includes('\0'), 'must be a relative path inside the repository')

/** C1 authorization operations. modify does not imply delete/migrate, and vice versa. */
export const ASSET_OPS = ['modify', 'delete', 'migrate'] as const
export type AssetOp = (typeof ASSET_OPS)[number]

/** C1: an authorization names one exact workspace-relative file (no globs) and one operation. */
const authorizationSchema = z.object({
  path: relative.refine(v => !/[*?\[\]{}]/.test(v) && !v.endsWith('/'), 'authorization path must be one exact file, not a glob or directory'),
  op: z.enum(ASSET_OPS),
}).strict()

const acceptanceSchema = z.object({
  id: z.string().regex(ID),
  text: z.string().trim().min(1),
  check: z.string().regex(ID),
  paths: z.array(relative).min(1),
  /** C1: only valid on task card version 2. Authorizes this item to modify/delete/migrate protected assets. */
  authorizes: z.array(authorizationSchema).optional(),
}).strict()

export const DEFAULT_PROTECTED = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*Test.java', '**/*_test.go', '**/test_*.py']

export const taskCardSchema = z.object({
  /**
   * C1: version 2 adds the protected-asset fields below. Version 1 cards keep their
   * historical meaning (no protected assets, no authorizations) and are still accepted.
   */
  version: z.union([z.literal(1), z.literal(2)]),
  goal: z.string().trim().min(1),
  outOfScope: z.array(z.string().trim().min(1)).default([]),
  acceptance: z.array(acceptanceSchema).min(1),
  /** A hard limit only when the Issue author asks for one. */
  budget: z.object({
    maxFiles: z.number().int().min(1).optional(),
    maxChangedLines: z.number().int().min(1).optional(),
  }).strict().optional(),
  protect: z.array(relative).default(DEFAULT_PROTECTED),
  /** C1 (version 2): protected acceptance assets (glob syntax, same as `protect`). */
  protectedAssets: z.array(relative).optional(),
}).strict().superRefine((card, ctx) => {
  if (card.version === 1) {
    if (card.protectedAssets !== undefined) ctx.addIssue({ code: 'custom', message: 'protectedAssets requires task card version 2' })
    if (card.acceptance.some(item => item.authorizes !== undefined)) ctx.addIssue({ code: 'custom', message: 'authorizes requires task card version 2' })
  }
  const ids = new Set<string>()
  for (const a of card.acceptance) {
    if (ids.has(a.id)) ctx.addIssue({ code: 'custom', message: `duplicate acceptance id: ${a.id}` })
    ids.add(a.id)
  }
  // Authorizations may not target the same (path, op) twice: ambiguity is a config error.
  const seenAuthorizations = new Set<string>()
  for (const item of card.acceptance) {
    for (const authorization of item.authorizes ?? []) {
      const key = `${item.id}\0${authorization.path}\0${authorization.op}`
      if (seenAuthorizations.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate authorization in ${item.id}: ${authorization.path} ${authorization.op}` })
      seenAuthorizations.add(key)
    }
  }
})

export type TaskCard = z.infer<typeof taskCardSchema>

export function parseTaskCard(input: unknown): TaskCard {
  return taskCardSchema.parse(input)
}

const FENCE = /^(`{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm

/** Extract the single ```hephi-task``` JSON block from an Issue body. */
export function parseIssueTask(body: string): TaskCard | undefined {
  let raw: string | undefined
  for (const match of body.replace(/\r\n/g, '\n').matchAll(FENCE)) {
    const kind = match[2].trim().split(/\s+/)[0]
    if (kind === 'hephi-test') throw new Error('hephi-test blocks are not supported; name a project check in the acceptance item instead')
    if (kind !== 'hephi-task') continue
    if (raw !== undefined) throw new Error('Issue contains more than one hephi-task block')
    raw = match[3]
  }
  if (raw === undefined) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (error) { throw new Error(`hephi-task block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
  return parseTaskCard(parsed)
}
