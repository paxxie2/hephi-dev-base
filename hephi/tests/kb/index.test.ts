import { parseVerificationConfig } from '../../src/contracts/checks.js'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationContract } from '../../src/control/activation.js'
import { requireKnowledgeQuery, searchKnowledgeBase } from '../../src/kb/index.js'

const run = promisify(execFile)

async function gitRepository(): Promise<{ workspace: string; baseSha: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'hephi-kb-repo-'))
  await run('git', ['init', '-b', 'main', workspace])
  await run('git', ['config', 'user.email', 'hephi@example.test'], { cwd: workspace })
  await run('git', ['config', 'user.name', 'Hephi Test'], { cwd: workspace })
  await mkdir(join(workspace, 'dubbo-common/src/main/java/org/apache/dubbo/common'), { recursive: true })
  await mkdir(join(workspace, 'dubbo-common/src/test/java/org/apache/dubbo/common'), { recursive: true })
  await mkdir(join(workspace, 'dubbo-rpc/src/main/java/org/apache/dubbo/rpc'), { recursive: true })
  await writeFile(join(workspace, 'dubbo-common/src/main/java/org/apache/dubbo/common/NetUtils.java'), 'class NetUtils { String hostPort; }\n')
  await writeFile(join(workspace, 'dubbo-common/src/test/java/org/apache/dubbo/common/NetUtilsTest.java'), 'class NetUtilsTest { void hostPort() {} }\n')
  await writeFile(join(workspace, 'dubbo-rpc/src/main/java/org/apache/dubbo/rpc/Protocol.java'), 'class Protocol {}\n')
  await run('git', ['add', '.'], { cwd: workspace })
  await run('git', ['commit', '-m', 'base'], { cwd: workspace })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim()
  return { workspace, baseSha }
}

function contract(workspace: string, baseSha: string): ActivationContract {
  return {
    enabled: true,
    verification: parseVerificationConfig({ version: 1, checks: [{ id: 'fixture', kind: 'build', purpose: 'fixture only', command: 'true', args: [] }] }),
    ticketId: 'ticket-kb',
    repository: 'paxxie2/dubbo',
    issueNumber: 42,
    workspace,
    baseRef: 'main',
    baseSha,
    allowedPaths: ['dubbo-*/**', 'pom.xml'],
    requirePullRequest: true,
    contractHash: 'sha256:test',
  }
}

describe('knowledge base context pack', () => {
  const previousConfig = process.env.HEPHI_KB_CONFIG
  afterEach(() => {
    if (previousConfig === undefined) delete process.env.HEPHI_KB_CONFIG
    else process.env.HEPHI_KB_CONFIG = previousConfig
  })

  it('reads Topic Bench source objects and binds the query to its contract', async () => {
    const repo = await gitRepository()
    await mkdir(join(repo.workspace, 'test'))
    await writeFile(join(repo.workspace, 'test/model.test.mjs'), '// normalizeDb regression')
    await run('git', ['add', '.'], { cwd: repo.workspace })
    await run('git', ['commit', '-m', 'node test'], { cwd: repo.workspace })
    repo.baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo.workspace })).stdout.trim()
    const root = await mkdtemp(join(tmpdir(), 'hephi-topic-kb-'))
    const state = await mkdtemp(join(tmpdir(), 'hephi-topic-state-'))
    await mkdir(join(root, 'objects'))
    await writeFile(join(root, 'objects/model.md'), '# Data model\nnormalizeDb source notes')
    await writeFile(join(root, 'index.json'), JSON.stringify({ repository: 'paxxie2/topic-bench', sourceCommit: repo.baseSha,
      objects: [{ id: 'model', title: '数据模型', file: 'objects/model.md', summary: 'normalizeDb', keywords: ['normalizeDb'], sources: ['lib/model.js'] }] }))
    process.env.HEPHI_KB_CONFIG = JSON.stringify({ 'paxxie2/topic-bench': root })
    const activation = { ...contract(repo.workspace, repo.baseSha), repository: 'paxxie2/topic-bench' }
    await expect(requireKnowledgeQuery(activation, state)).rejects.toThrow()
    const result = await searchKnowledgeBase(activation, 'normalizeDb', 3, state)
    expect(result.matches[0]).toMatchObject({ id: 'model', sourceCommit: repo.baseSha, referenceOnly: true })
    expect(result.contextPack?.baseMap.candidateTests).toEqual(['test/model.test.mjs'])
    await expect(requireKnowledgeQuery(activation, state)).resolves.toBeUndefined()
    await writeFile(join(root, 'index.json'), JSON.stringify({ repository: 'other/repo', objects: [] }))
    await expect(searchKnowledgeBase(activation, 'normalizeDb', 3, state)).rejects.toThrow('repository mismatch')
  })

  it('builds a baseSha-bound map and records the query', async () => {
    const repo = await gitRepository()
    const kbRoot = await mkdtemp(join(tmpdir(), 'hephi-kb-root-'))
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-kb-state-'))
    await writeFile(join(kbRoot, 'index.json'), JSON.stringify({ records: [{ meta: { id: 'historical-1' }, body: '# NetUtils\nHistorical host port fix', file: 'objects/historical-1.md' }] }))
    process.env.HEPHI_KB_CONFIG = JSON.stringify({ 'paxxie2/dubbo': kbRoot })

    const result = await searchKnowledgeBase(contract(repo.workspace, repo.baseSha), 'NetUtils host port', 3, stateDir, repo.workspace)
    expect(result.enabled).toBe(true)
    expect(result.matches.map(item => item.id)).toContain('historical-1')
    expect(result.contextPack).toMatchObject({
      version: 1,
      baseSha: repo.baseSha,
      referenceOnly: true,
      baseMap: {
        candidateModules: ['dubbo-common'],
        candidateFiles: [
          'dubbo-common/src/main/java/org/apache/dubbo/common/NetUtils.java',
          'dubbo-common/src/test/java/org/apache/dubbo/common/NetUtilsTest.java',
        ],
        candidateTests: ['dubbo-common/src/test/java/org/apache/dubbo/common/NetUtilsTest.java'],
        truncated: false,
      },
    })
    const query = JSON.parse(await readFile(join(stateDir, 'hephi', 'ticket-kb', 'kb-query.json'), 'utf8')) as Record<string, unknown>
    expect(query).toMatchObject({ ticketId: 'ticket-kb', contractHash: 'sha256:test', status: 'success', matches: ['historical-1'] })
  })

  it('returns an empty base map for a query with no matches', async () => {
    const repo = await gitRepository()
    const kbRoot = await mkdtemp(join(tmpdir(), 'hephi-kb-root-'))
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-kb-state-'))
    await writeFile(join(kbRoot, 'index.json'), JSON.stringify({ records: [] }))
    process.env.HEPHI_KB_CONFIG = JSON.stringify({ 'paxxie2/dubbo': kbRoot })

    const result = await searchKnowledgeBase(contract(repo.workspace, repo.baseSha), 'nonexistent-symbol', 3, stateDir, repo.workspace)
    expect(result.contextPack?.baseMap).toEqual({
      candidateModules: [],
      candidateFiles: [],
      candidateTests: [],
      unknowns: ['callEntries are not computed'],
      truncated: false,
    })
    await expect(requireKnowledgeQuery(contract(repo.workspace, repo.baseSha), stateDir)).resolves.toBeUndefined()
  })

  async function queryFixture() {
    const repo = await gitRepository()
    const kbRoot = await mkdtemp(join(tmpdir(), 'hephi-kb-root-'))
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-kb-state-'))
    await writeFile(join(kbRoot, 'index.json'), JSON.stringify({ records: [] }))
    process.env.HEPHI_KB_CONFIG = JSON.stringify({ 'paxxie2/dubbo': kbRoot })
    return { ...repo, stateDir, activation: contract(repo.workspace, repo.baseSha) }
  }

  it('does not record success when baseMap fails', async () => {
    const fixture = await queryFixture()
    const invalid = { ...fixture.activation, baseSha: 'f'.repeat(40) }
    await expect(searchKnowledgeBase(invalid, 'NetUtils', 3, fixture.stateDir)).rejects.toThrow('baseMap git grep failed')
    await expect(requireKnowledgeQuery(invalid, fixture.stateDir)).rejects.toThrow()
    await expect(readFile(join(fixture.stateDir, 'hephi', invalid.ticketId, 'kb-query.json'))).rejects.toThrow()
  })

  it('preserves an earlier successful query for the same contract after a later failure', async () => {
    const fixture = await queryFixture()
    const result = await searchKnowledgeBase(fixture.activation, 'NetUtils', 3, fixture.stateDir)
    const original = await readFile(result.recordPath!, 'utf8')
    await expect(searchKnowledgeBase(fixture.activation, 'hostPort', 3, fixture.stateDir, fixture.stateDir)).rejects.toThrow('baseMap git grep failed')
    expect(await readFile(result.recordPath!, 'utf8')).toBe(original)
    await expect(requireKnowledgeQuery(fixture.activation, fixture.stateDir)).resolves.toBeUndefined()
    await expect(requireKnowledgeQuery({ ...fixture.activation, contractHash: 'different' }, fixture.stateDir)).rejects.toThrow()
  })

  it('keeps precise symbols beyond introductory words and returns full source modules', async () => {
    const fixture = await queryFixture()
    const module = 'dubbo-rpc/dubbo-rpc-triple'
    const files = ['PathUtils', 'PathCondition', 'RadixTree'].map(name => `${module}/src/main/java/${name}.java`)
    files.push(`${module}/src/test/groovy/RadixTreeTest.groovy`)
    for (const file of files) {
      await mkdir(join(fixture.workspace, file, '..'), { recursive: true })
      await writeFile(join(fixture.workspace, file), 'PathUtils PathCondition RadixTree\n')
    }
    await mkdir(join(fixture.workspace, '.github'))
    await writeFile(join(fixture.workspace, '.github/noise'), '53 triple rest mapping\n'.repeat(200))
    await writeFile(join(fixture.workspace, 'dubbo-common/src/main/java/org/apache/dubbo/common/OnlyIssueNumber.java'), '53\n')
    await run('git', ['add', '.'], { cwd: fixture.workspace })
    await run('git', ['commit', '-m', 'source and noise'], { cwd: fixture.workspace })
    const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: fixture.workspace })).stdout.trim()
    const query = "Triple REST cuts mapping and filter patterns at '?' dubbo-rpc-triple PathUtils normalize PathCondition RadixTree question mark truncation"
    const result = await searchKnowledgeBase({ ...fixture.activation, issueNumber: 53, baseSha }, query, 3, fixture.stateDir)
    expect(result.contextPack?.baseMap.candidateFiles).toEqual(expect.arrayContaining(files))
    expect(result.contextPack?.baseMap.candidateModules).toContain(module)
    expect(result.contextPack?.baseMap.candidateTests).toContain(files[3])
    expect(result.contextPack?.baseMap.candidateFiles.some(file => file.includes('.github') || file.includes('OnlyIssueNumber'))).toBe(false)
  })

  it('ranks distinct keyword hits before truncation and ignores repeated matching lines', async () => {
    const fixture = await queryFixture()
    const directory = 'dubbo-common/src/main/java'
    for (let index = 0; index < 65; index++) await writeFile(join(fixture.workspace, directory, `A${index}.java`), 'WidgetAlpha\n'.repeat(130))
    const best = `${directory}/ZBest.java`
    await writeFile(join(fixture.workspace, best), 'WidgetAlpha WidgetBeta\n')
    await run('git', ['add', '.'], { cwd: fixture.workspace })
    await run('git', ['commit', '-m', 'rank fixture'], { cwd: fixture.workspace })
    const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: fixture.workspace })).stdout.trim()
    await writeFile(join(fixture.workspace, directory, 'Uncommitted.java'), 'WidgetAlpha WidgetBeta\n')
    const result = await searchKnowledgeBase({ ...fixture.activation, baseSha }, 'WidgetAlpha WidgetAlpha WidgetBeta', 3, fixture.stateDir)
    expect(result.contextPack?.baseMap.candidateFiles).toHaveLength(60)
    expect(result.contextPack?.baseMap.candidateFiles[0]).toBe(best)
    expect(result.contextPack?.baseMap.candidateFiles.some(file => file.includes('Uncommitted'))).toBe(false)
    expect(result.contextPack?.baseMap.truncated).toBe(true)
  })
})
