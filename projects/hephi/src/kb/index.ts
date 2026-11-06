import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, dirname, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { ActivationContract } from '../control/activation.js'

export type KnowledgeBaseConfig = Record<string, string>
export type KnowledgeQuery = { repository: string; issueNumber: number; query: string; limit: number; matches: string[]; ticketId: string; contractHash: string; status: 'success'; queriedAt: string }
export type BaseMap = {
  candidateModules: string[]
  candidateFiles: string[]
  candidateTests: string[]
  unknowns: string[]
  truncated: boolean
}
export type ContextPack = {
  version: 1
  contractHash: string
  baseSha: string
  allowedPaths: string[]
  verificationChecks: string[]
  baseMap: BaseMap
  historicalReferences: Array<Record<string, unknown>>
  referenceOnly: true
}

const run = promisify(execFile)
const BASE_MAP_MAX_FILES = 60
const QUERY_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'issue', 'fix', 'bug', 'dubbo'])

const defaultRoot = join(homedir(), 'Documents/deepseek-harness/default-workspace/hephi/kb')
export function loadKnowledgeBases(): KnowledgeBaseConfig {
  const raw = process.env.HEPHI_KB_CONFIG
  if (raw) return JSON.parse(raw) as KnowledgeBaseConfig
  const root = process.env.HEPHI_KB_ROOT?.trim() || defaultRoot
  return { 'apache/dubbo': root, 'paxxie2/dubbo': root, 'paxxie2/topic-bench': join(homedir(), 'Documents/deepseek-harness/default-workspace/topic-bench/kb') }
}

export function queryPath(stateDir: string, ticketId: string): string {
  return join(stateDir, 'hephi', ticketId, 'kb-query.json')
}

function queryTerms(query: string): string[] {
  const values = query.split(/[^a-z0-9_./-]+/i)
    .filter(value => value.length >= 3 && /[a-z]/i.test(value) && !QUERY_STOP_WORDS.has(value.toLowerCase()))
  // Preserve explicit symbols/paths before limiting prose-heavy Issue queries.
  const precise = (value: string) => /[a-z][A-Z]|[a-z0-9][_.\/-][a-z0-9]/.test(value)
  return [...new Set([...values.filter(precise), ...values.filter(value => !precise(value))].map(value => value.toLowerCase()))].slice(0, 8)
}

function moduleForPath(file: string): string {
  return file.match(/^(.*?)\/?src\/(?:main|test)\//)?.[1] || 'root'
}

async function buildBaseMap(contract: ActivationContract, query: string, workspace: string): Promise<BaseMap> {
  const terms = queryTerms(query)
  const unknowns = ['callEntries are not computed']
  if (!terms.length) return { candidateModules: [], candidateFiles: [], candidateTests: [], unknowns: [...unknowns, 'query did not contain searchable terms'], truncated: false }

  const scores = new Map<string, number>()
  for (const term of terms) {
    const args = ['grep', '--full-name', '--name-only', '-z', '--ignore-case', '--fixed-strings', '-I', '-e', term,
      contract.baseSha, '--', ...(contract.repository === 'paxxie2/topic-bench'
        ? ['server.js', 'lib/', 'web/', 'shared/', 'sidebar/', 'scripts/', 'types/', 'test/']
        : [':(glob)**/src/main/**', ':(glob)**/src/test/**'])]
    let stdout: string
    try {
      stdout = (await run('git', args, { cwd: workspace, maxBuffer: 8 * 1024 * 1024 })).stdout ?? ''
    } catch (error: any) {
      if (error?.code === 1) continue
      throw new Error(`baseMap git grep failed: ${error?.stderr ?? error?.message ?? String(error)}`)
    }
    const prefix = `${contract.baseSha}:`
    const files = new Set(stdout.split('\0').filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length)))
    for (const file of files) scores.set(file, (scores.get(file) ?? 0) + 1)
  }
  const candidateFiles = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || (a < b ? -1 : a > b ? 1 : 0)).slice(0, BASE_MAP_MAX_FILES)
  const candidateTests = candidateFiles.filter(file => /\/src\/test\//.test(`/${file}`) || /^test\/.+\.test\.mjs$/.test(file) || /(?:Test|IT)\.(?:java|groovy|kt)$/.test(file))
  const candidateModules = [...new Set(candidateFiles.map(moduleForPath))].sort()
  const truncated = scores.size > BASE_MAP_MAX_FILES
  return { candidateModules, candidateFiles, candidateTests, unknowns, truncated }
}

export async function searchKnowledgeBase(contract: ActivationContract, query: string, limit = 3, stateDir?: string, workspace = contract.workspace): Promise<{ enabled: boolean; matches: Array<Record<string, unknown>>; contextPack?: ContextPack; recordPath?: string }> {
  const root = loadKnowledgeBases()[contract.repository]
  if (!root) return { enabled: false, matches: [] }
  const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as { repository?: string; sourceCommit?: string; objects?: Array<{ id: string; title: string; file: string; summary: string; keywords: string[]; sources: unknown[] }>; records?: Array<{ meta?: Record<string, unknown>; body?: string; file?: string }> }
  if (index.objects) {
    if (index.repository !== contract.repository) throw new Error('knowledge base repository mismatch')
    index.records = await Promise.all(index.objects.map(async object => {
      const file = resolve(root, object.file)
      if (!file.startsWith(resolve(root) + sep)) throw new Error('knowledge object path escapes KB')
      const body = await readFile(file, 'utf8')
      return { meta: { id: object.id, sourceCommit: index.sourceCommit, keywords: object.keywords, sources: object.sources }, file: object.file, body: `# ${object.title}\n${object.summary}\n${body}` }
    }))
  }
  const terms = [String(contract.issueNumber), ...query.toLowerCase().split(/\s+/).filter(Boolean)]
  const records = (index.records ?? []).map(record => ({ ...record, text: JSON.stringify(record).toLowerCase() }))
    .map(record => ({ record, score: terms.reduce((score, term) => score + (record.text.includes(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 10)))
  const matches = records.map(({ record }) => ({ id: record.meta?.id, file: record.file, title: record.body?.split('\n').find(line => line.startsWith('# '))?.slice(2), summary: record.body?.split('\n').filter(Boolean).slice(0, 8).join('\n'), confidence: record.meta?.confidence, lastVerifiedAt: record.meta?.last_verified_at, sourceCommit: record.meta?.sourceCommit, sources: record.meta?.sources, referenceOnly: true }))
  // Failed map construction must not create or replace a successful query record.
  const baseMap = await buildBaseMap(contract, query, workspace)
  const path = queryPath(stateDir?.trim() || process.env.HEPHI_STATE_DIR?.trim() || join(homedir(), '.dsh', 'state', 'superagent-desktop'), contract.ticketId)
  await mkdir(dirname(path), { recursive: true })
  const record: KnowledgeQuery = { repository: contract.repository, issueNumber: contract.issueNumber, query, limit, matches: matches.map(item => String(item.id ?? item.file ?? '')), ticketId: contract.ticketId, contractHash: contract.contractHash, status: 'success', queriedAt: new Date().toISOString() }
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
  await rename(temp, path)
  const contextPack: ContextPack = {
    version: 1,
    contractHash: contract.contractHash,
    baseSha: contract.baseSha,
    allowedPaths: contract.allowedPaths,
    verificationChecks: contract.verification.checks.map(check => check.id),
    baseMap,
    historicalReferences: matches,
    referenceOnly: true,
  }
  return { enabled: true, matches, contextPack, recordPath: path }
}

export async function requireKnowledgeQuery(contract: ActivationContract, stateDir?: string): Promise<void> {
  if (!loadKnowledgeBases()[contract.repository]) return
  const path = queryPath(stateDir || process.env.HEPHI_STATE_DIR?.trim() || join(homedir(), '.dsh', 'state', 'superagent-desktop'), contract.ticketId)
  const record = JSON.parse(await readFile(path, 'utf8')) as Partial<KnowledgeQuery>
  if (record.status !== 'success' || record.ticketId !== contract.ticketId || record.contractHash !== contract.contractHash || record.repository !== contract.repository || record.issueNumber !== contract.issueNumber) throw new Error('knowledge base query is required for this repository and contract')
}
