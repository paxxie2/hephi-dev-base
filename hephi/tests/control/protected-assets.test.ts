/**
 * C1 受保护验收资产（本地单测/模拟级，不连真实宿主）。
 *
 * 覆盖：未授权 modify/delete 拒绝；授权后放行；modify 授权不覆盖 delete；跨验收项授权不生效；
 * 授权不能越过 allowedPaths / 验收项 paths；shell 绕过在 ready 按最终 diff 复核拒绝；
 * 清单外已有测试修改只记录 asset.modified；授权命中记录 asset.authorized；任务卡 v1/合同 v3 兼容。
 *
 * 可声称边界：只证明本地机制与决策日志规则；不证明真实宿主证据链或“不可绕过”。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ACTIVATION_VERSION, activationPath, canonicalPayload, contractHash, loadActivation, prepareActivation,
} from '../../src/control/activation.js'
import { parseIssueTask } from '../../src/contracts/task.js'
import { assetProblems, authorizedAcceptance, disciplineProblems, protectedAssetsOf, summarizeChanges } from '../../src/control/discipline.js'
import { createEvidenceVerifier } from '../../src/control/evidence-verifier.js'
import { mountWorkerGate } from '../../src/control/worker-mount.js'

const run = promisify(execFile)
const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

const TICKET = 'ticket-1'
const KEY = 'tests/acceptance/key.test.js'
const OTHER = 'tests/other/legacy.test.js'

async function repo(): Promise<{ dir: string; baseSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-c1-repo-'))
  cleanup.push(dir)
  await run('git', ['init', '-b', 'main', dir])
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Protected test'], { cwd: dir })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:example/protected-fixture.git'], { cwd: dir })
  for (const [path, body] of [
    ['src/app.js', 'module.exports = 1\n'],
    [KEY, 'assert.equal(1, 1)\n'],
    [OTHER, 'assert.equal(2, 2)\n'],
    ['docs/notes.md', 'notes\n'],
  ] as const) {
    const full = join(dir, path)
    await run('mkdir', ['-p', join(full, '..')])
    await writeFile(full, body)
  }
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'base'], { cwd: dir })
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
  await writeFile(join(dir, 'src/app.js'), 'module.exports = 2\n')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'patch'], { cwd: dir })
  return { dir, baseSha }
}

const fence = (value: unknown) => ['```hephi-task', JSON.stringify(value, null, 2), '```'].join('\n')

function card(over: {
  version?: 1 | 2
  protectedAssets?: string[]
  authorizes?: Array<{ path: string; op: 'modify' | 'delete' | 'migrate'; replacement?: string }>
  paths?: string[]
} = {}) {
  const version = over.version ?? 2
  return {
    version,
    goal: 'change the price fixture',
    outOfScope: [],
    ...(over.protectedAssets !== undefined ? { protectedAssets: over.protectedAssets } : {}),
    acceptance: [{
      id: 'AC1',
      text: 'price fixture still proves the behaviour',
      check: 'tests',
      paths: over.paths ?? ['src/**', 'tests/**'],
      ...(over.authorizes !== undefined ? { authorizes: over.authorizes } : {}),
    }],
  }
}

function env(stateDir: string, repoDir: string, baseSha: string, issueBody: string, checks?: unknown): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1', HEPHI_STATE_DIR: stateDir, HEPHI_BASE_COMMIT: baseSha,
    HEPHI_ALLOWED_PATHS: 'src/**,tests/**',
    DSH_SUPERAGENT_TICKET: TICKET, DSH_SUPERAGENT_DIR: repoDir,
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'example/protected-fixture', DSH_SUPERAGENT_GITHUB_NUMBER: '7',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify(checks ?? {
      version: 1,
      checks: [{ id: 'tests', kind: 'test', purpose: 'project tests', command: 'true', args: [], required: true, timeoutMs: 5000 }],
    }),
    HEPHI_ISSUE_BODY: issueBody,
  }
}

type PreExecute = (execution: ToolExecution, next: () => Promise<any>) => Promise<any>
function fakeAgent(cwd: string) {
  const listeners = new Map<string, Function>()
  const agent = {
    session: { header: { id: 'worker-ticket-1', agentPreset: 'dsh-superagent-worker', cwd } },
    ctx: {
      on: (name: string, listener: Function) => { listeners.set(name, listener); return () => listeners.delete(name) },
      tools: { register: () => () => true, guard: () => () => true },
      systemPrompt: { section: () => () => true },
      get: () => undefined,
    },
  } as unknown as Agent
  return { agent, callbacks: () => ({ preExecute: listeners.get('tools/pre-execute') as PreExecute | undefined }) }
}

function editCall(path: string, callId = 'call-edit'): ToolExecution {
  return { name: 'edit', arguments: { path }, callId, rootCallId: callId, token: Symbol('edit') as never } as unknown as ToolExecution
}
function readyCall(agent: Agent, callId = 'call-ready'): ToolExecution {
  return { name: 'orchestrator_report', arguments: { state: 'ready' }, callId, rootCallId: callId, token: Symbol('ready') as never, agent } as unknown as ToolExecution
}
async function commit(repoDir: string, message: string) {
  await run('git', ['add', '-A'], { cwd: repoDir })
  await run('git', ['commit', '-m', message], { cwd: repoDir })
}
async function decisions(stateDir: string): Promise<any[]> {
  const text = await readFile(join(stateDir, 'hephi', TICKET, 'decisions.jsonl'), 'utf8')
  return text.trim().split('\n').map(line => JSON.parse(line))
}
async function rules(stateDir: string): Promise<string[]> {
  return (await decisions(stateDir)).map(entry => entry.rule)
}

async function mount(stateDir: string, repoDir: string, options: { verify?: (contract: any, execution: ToolExecution) => Promise<{ ok: true } | { ok: false; reason: string }> } = {}) {
  const fake = fakeAgent(repoDir)
  const mounted = mountWorkerGate({} as Context, fake.agent, {
    stateDir,
    verify: options.verify ?? (async () => ({ ok: true as const })),
  })!
  return { fake, mounted }
}

describe('C1 task card / contract schema', () => {
  it('C1-01: version 2 accepts protectedAssets and authorizes; version 1 rejects them', () => {
    const v2 = parseIssueTask(fence(card({ protectedAssets: ['tests/acceptance/**'], authorizes: [{ path: KEY, op: 'modify' }] })))
    expect(v2?.protectedAssets).toEqual(['tests/acceptance/**'])
    expect(v2?.acceptance[0]?.authorizes).toEqual([{ path: KEY, op: 'modify' }])
    expect(() => parseIssueTask(fence(card({ version: 1, protectedAssets: ['tests/**'] })))).toThrow(/requires task card version 2/)
    expect(() => parseIssueTask(fence(card({ version: 2, authorizes: [{ path: 'tests/acceptance/*.test.js', op: 'modify' }] })))).toThrow(/exact file/)
    expect(() => parseIssueTask(fence(card({ version: 2, authorizes: [{ path: KEY, op: 'modify' }, { path: KEY, op: 'modify' }] })))).toThrow(/duplicate authorization/)
    // 旧 v1 任务卡仍然可解析，行为不变（无保护清单、无授权）。
    const legacy = parseIssueTask(fence(card({ version: 1 })))
    expect(legacy?.protectedAssets).toBeUndefined()
    expect(legacy?.acceptance[0]?.authorizes).toBeUndefined()
  })

  it('C1-02: prepare rejects a v3-style task card and freezes v4 contracts with protected assets', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    const prepared = await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'], authorizes: [{ path: KEY, op: 'modify' }] }))))
    if (!prepared.enabled) throw new Error('not enabled')
    const loaded = await loadActivation(prepared.filePath)
    expect(loaded.version).toBe(ACTIVATION_VERSION)
    // Contract format versions grow as later batches add frozen fields; keep this at least v4.
    expect(ACTIVATION_VERSION).toBeGreaterThanOrEqual(4)
    expect(loaded.task?.version).toBe(2)
    expect(loaded.task?.protectedAssets).toEqual(['tests/acceptance/**'])
    expect(protectedAssetsOf(loaded)).toEqual(['tests/acceptance/**'])
  })

  it('C1-03: an authorization outside allowedPaths or outside its acceptance paths is rejected', async () => {
    const r = await repo()
    const outside = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(outside)
    // 授权不能把 allowedPaths 外的文件变成合法。
    await expect(prepareActivation(env(outside, r.dir, r.baseSha, fence(card({ authorizes: [{ path: 'docs/notes.md', op: 'modify' }] })))))
      .rejects.toThrow(/outside contract allowedPaths/)
    const narrow = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(narrow)
    // 授权必须落在授权所在验收项的 paths 内（不能“随便找个验收项挂授权”）。
    await expect(prepareActivation(env(narrow, r.dir, r.baseSha, fence(card({ paths: ['src/**'], authorizes: [{ path: KEY, op: 'modify' }] })))))
      .rejects.toThrow(/outside its own paths/)
  })

  it('C1-04: an old version 3 contract still loads and carries no protection (read-only compatible)', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    const prepared = await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ version: 1 }))))
    if (!prepared.enabled) throw new Error('not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    raw.version = 3 // v3 合同只读兼容（无 C1 字段）
    raw.contractHash = contractHash(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'contractHash')) as never)
    await writeFile(prepared.filePath, `${JSON.stringify(raw, null, 2)}\n`)
    const loaded = await loadActivation(prepared.filePath)
    expect(loaded.version).toBe(3)
    expect(protectedAssetsOf(loaded)).toEqual([])
    // canonicalPayload 仅用于确认 v3 合同仍按规范化哈希读取（未额外改写合同）。
    expect(canonicalPayload({ ...raw, contractHash: undefined } as never)).toContain('"version":3')
  })
})

describe('C1 pre-execute (write/edit) gate', () => {
  it('C1-05: unauthorized modify of a protected asset is denied and logged', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'] }))))
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      const next = async () => ({ kind: 'allow' as const })
      const result = await fake.callbacks().preExecute!(editCall(KEY), next)
      expect(result).toMatchObject({ kind: 'deny', reason: expect.stringContaining('protected acceptance asset') })
      expect(await rules(stateDir)).toContain('asset.unauthorized-modify')
      // 可声称：write/edit 改动受保护资产且无同项同文件 modify 授权 → 当场拒绝。
    } finally { mounted.dispose() }
  })

  it('C1-06: authorized modify is allowed and recorded as asset.authorized', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'], authorizes: [{ path: KEY, op: 'modify' }] }))))
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      const next = async () => ({ kind: 'allow' as const })
      expect(await fake.callbacks().preExecute!(editCall(KEY), next)).toEqual({ kind: 'allow' })
      const authorized = (await decisions(stateDir)).filter(entry => entry.rule === 'asset.authorized')
      expect(authorized).toHaveLength(1)
      expect(authorized[0]).toMatchObject({ rule: 'asset.authorized', effectiveDecision: 'allow' })
      expect(String(authorized[0].reason)).toContain('AC1')
    } finally { mounted.dispose() }
  })

  it('C1-07: creating a new file under a protected glob is allowed (no authorization needed)', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'] }))))
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      const next = async () => ({ kind: 'allow' as const })
      expect(await fake.callbacks().preExecute!(editCall('tests/acceptance/new.test.js'), next)).toEqual({ kind: 'allow' })
    } finally { mounted.dispose() }
  })
})

describe('C1 ready-time final-diff recheck (shell/git bypass)', () => {
  it('C1-08: shell modification of a protected asset is denied at ready and logged', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'] }))))
    // shell 直接改受保护文件并提交（绕过 write/edit pre-execute）。
    await writeFile(join(r.dir, KEY), 'assert.equal(1, 1) // shell edit\n')
    await commit(r.dir, 'shell edit protected asset')
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      const result = await fake.callbacks().preExecute!(readyCall(fake.agent), async () => ({ kind: 'allow' as const }))
      expect(result).toMatchObject({ kind: 'deny', reason: expect.stringContaining('protected acceptance asset') })
      expect(await rules(stateDir)).toContain('asset.unauthorized-modify')
      // 直接调用 verifier 时也必须在 ready 拒绝（不依赖 mount 包装）。
      const contract = await loadActivation(activationPath(stateDir, TICKET))
      const verify = createEvidenceVerifier({ stateDir })
      const direct = await verify(contract, readyCall(fake.agent))
      expect(direct.ok).toBe(false)
      if (!direct.ok) expect(direct.reason).toContain('protected acceptance asset')
    } finally { mounted.dispose() }
  })

  it('C1-09: a modify authorization does not cover delete', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'], authorizes: [{ path: KEY, op: 'modify' }] }))))
    await rm(join(r.dir, KEY))
    await commit(r.dir, 'delete protected asset')
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      const result = await fake.callbacks().preExecute!(readyCall(fake.agent), async () => ({ kind: 'allow' as const }))
      expect(result).toMatchObject({ kind: 'deny', reason: expect.stringContaining('deleted without authorization') })
      expect(await rules(stateDir)).toContain('asset.unauthorized-delete')
      // 可声称：modify 授权不隐含 delete，删除仍拒绝。
    } finally { mounted.dispose() }
  })

  it('C1-10: modification of a non-protected existing test is allowed and records asset.modified', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    // 保护清单只含 tests/acceptance/**；tests/other/legacy.test.js 属于旧 protect 清单但不在 C1 清单内。
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'] }))))
    await writeFile(join(r.dir, OTHER), 'assert.equal(2, 2) // edited\n')
    await commit(r.dir, 'edit non-protected test')
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      expect(await fake.callbacks().preExecute!(readyCall(fake.agent), async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'allow' })
      const modified = (await decisions(stateDir)).filter(entry => entry.rule === 'asset.modified')
      expect(modified).toHaveLength(1)
      expect(modified[0]).toMatchObject({ rule: 'asset.modified', effectiveDecision: 'allow' })
      // 可声称：清单外已有测试的修改放行且仅记录；删除仍受旧 protect 规则约束（C1-12 覆盖）。
    } finally { mounted.dispose() }
  })

  it('C1-11: an authorized deletion of an old test with an added replacement can be delivered', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'], authorizes: [{ path: KEY, op: 'delete' }] }))))
    await rm(join(r.dir, KEY))
    await writeFile(join(r.dir, 'tests/acceptance/replacement.test.js'), 'assert.equal(1, 1)\n')
    await commit(r.dir, 'replace acceptance test')
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    // 旧 protect 规则不得再拒绝“已授权删除”的受保护资产。
    expect(disciplineProblems(contract, await summarizeChanges(r.dir, r.baseSha))).toEqual([])
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      expect(await fake.callbacks().preExecute!(readyCall(fake.agent), async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'allow' })
      const authorized = (await decisions(stateDir)).filter(entry => entry.rule === 'asset.authorized')
      expect(authorized.some(entry => String(entry.reason).includes('deleted'))).toBe(true)
      // 可声称：合法需求变更（授权删除旧测试 + 新增替代测试）可以交付。
    } finally { mounted.dispose() }
  })

  it('C1-12: without C1 fields (task card v1) behaviour is unchanged', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ version: 1 }))))
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    expect(protectedAssetsOf(contract)).toEqual([])
    // 修改已有测试仍放行（旧行为：只记录不拦截；删除才拒）。
    await writeFile(join(r.dir, OTHER), 'assert.equal(2, 2) // v1 edit\n')
    await commit(r.dir, 'v1 edit non-protected test')
    expect(disciplineProblems(contract, await summarizeChanges(r.dir, r.baseSha))).toEqual([])
    // 删除已有测试仍按旧规则拒绝。
    await rm(join(r.dir, OTHER))
    await commit(r.dir, 'v1 delete existing test')
    expect(disciplineProblems(contract, await summarizeChanges(r.dir, r.baseSha)).join('; ')).toContain('existing tests must not be deleted')
    // 可声称：v1 任务卡无保护清单/授权，行为与旧规则一致（modify 放行、delete 拒）。
  })
})

describe('C1 authorization matching (unit level)', () => {
  it('C1-13: cross-item / cross-file / cross-op authorizations do not apply', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ protectedAssets: ['tests/acceptance/**'], authorizes: [{ path: KEY, op: 'modify' }] }))))
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    expect(authorizedAcceptance(contract, KEY, 'modify')).toBe('AC1')
    expect(authorizedAcceptance(contract, KEY, 'delete')).toBeUndefined() // 不跨操作
    expect(authorizedAcceptance(contract, 'tests/acceptance/other.test.js', 'modify')).toBeUndefined() // 不跨文件
    // 跨验收项：授权留在不包含该文件的验收项里，另一个包含该文件的验收项没有授权 → 不生效。
    const moved: typeof contract = {
      ...contract,
      task: {
        ...contract.task!,
        acceptance: [
          { ...contract.task!.acceptance[0]!, id: 'AC1', paths: ['src/**'], authorizes: [{ path: KEY, op: 'modify' as const }] },
          { ...contract.task!.acceptance[0]!, id: 'AC2', paths: [KEY], authorizes: undefined },
        ],
      },
    }
    expect(authorizedAcceptance(moved, KEY, 'modify')).toBeUndefined()
  })

  it('C1-15: a migrate authorization covers deletion only when its replacement file is added', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: 'tests/acceptance/new.test.js' }],
    }))))
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    const deletedOnly = { files: [KEY], added: [] as string[], deleted: [KEY], changedLines: 0 }
    // migrate 授权不能当成普通 delete：没有新增替代文件时仍拒绝。
    expect(assetProblems(contract, deletedOnly).join('; ')).toContain('deleted without authorization')
    const unrelated = { files: [KEY, 'tests/acceptance/other.test.js'], added: ['tests/acceptance/other.test.js'], deleted: [KEY], changedLines: 0 }
    expect(assetProblems(contract, unrelated).join('; ')).toContain('deleted without authorization')
    const withReplacement = { files: [KEY, 'tests/acceptance/new.test.js'], added: ['tests/acceptance/new.test.js'], deleted: [KEY], changedLines: 0 }
    expect(assetProblems(contract, withReplacement)).toEqual([])
  })

  it('C1-14: project-level protectedAssets are honoured without task-card protection', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    const checks = {
      version: 1,
      protectedAssets: ['tests/acceptance/**'],
      checks: [{ id: 'tests', kind: 'test', purpose: 'project tests', command: 'true', args: [], required: true, timeoutMs: 5000 }],
    }
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({ version: 1 })), checks))
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    expect(protectedAssetsOf(contract)).toEqual(['tests/acceptance/**'])
    // shell 修改项目级受保护资产：ready 由 discipline 拒绝。
    await writeFile(join(r.dir, KEY), 'assert.equal(1, 1) // project protected\n')
    await commit(r.dir, 'edit project-protected asset')
    expect(disciplineProblems(contract, await summarizeChanges(r.dir, r.baseSha)).join('; ')).toContain('protected acceptance asset')
  })
})

describe('C1 migrate tightening (m3)', () => {
  const REPLACEMENT = 'tests/acceptance/migrated.test.js'

  it('C1-MIG-01: a migrate authorization with the exact added replacement is allowed and audited', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: REPLACEMENT }],
    }))))
    await rm(join(r.dir, KEY))
    await writeFile(join(r.dir, REPLACEMENT), 'assert.equal(1, 1)\n')
    await commit(r.dir, 'migrate acceptance key')
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    expect(disciplineProblems(contract, await summarizeChanges(r.dir, r.baseSha))).toEqual([])
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      expect(await fake.callbacks().preExecute!(readyCall(fake.agent), async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'allow' })
      const authorized = (await decisions(stateDir)).filter(entry => entry.rule === 'asset.authorized')
      expect(authorized).toHaveLength(1)
      expect(String(authorized[0].reason)).toContain(REPLACEMENT)
      // 可声称：migrate 只在原文件删除、声明 replacement 为本次新增且仍在时放行并审计。
    } finally { mounted.dispose() }
  })

  it('C1-MIG-02: prepare rejects a migrate authorization without replacement, or whose replacement is the original path', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await expect(prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate' }],
    }))))).rejects.toThrow(/migrate authorization for .* requires replacement/)
    expect(() => parseIssueTask(fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: KEY }],
    })))).toThrow(/replacement must differ from the original path/)
  })

  it('C1-MIG-03: a declared replacement that was not added denies the delete and records asset.unauthorized-delete', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: REPLACEMENT }],
    }))))
    await rm(join(r.dir, KEY))
    await commit(r.dir, 'delete without the declared replacement')
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    const problems = disciplineProblems(contract, await summarizeChanges(r.dir, r.baseSha)).join('; ')
    expect(problems).toContain('deleted without authorization')
    expect(problems).toContain('migrate not established')
    expect(problems).toContain(`replacement ${REPLACEMENT} was not added in this change`)
    const { fake, mounted } = await mount(stateDir, r.dir)
    try {
      const result = await fake.callbacks().preExecute!(readyCall(fake.agent), async () => ({ kind: 'allow' as const }))
      expect(result).toMatchObject({ kind: 'deny', reason: expect.stringContaining('migrate not established') })
      expect(await rules(stateDir)).toContain('asset.unauthorized-delete')
    } finally { mounted.dispose() }
  })

  it('C1-MIG-04: an unrelated new file does not satisfy the migrate replacement', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: REPLACEMENT }],
    }))))
    await rm(join(r.dir, KEY))
    await writeFile(join(r.dir, 'tests/acceptance/unrelated.test.js'), 'assert.equal(9, 9)\n')
    await commit(r.dir, 'unrelated new test is not a migration')
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    const problems = assetProblems(contract, await summarizeChanges(r.dir, r.baseSha)).join('; ')
    expect(problems).toContain('deleted without authorization')
    expect(problems).toContain(`replacement ${REPLACEMENT} was not added in this change`)
  })

  it('C1-MIG-05: a migrate authorization does not cover a modification of the original file', async () => {
    const r = await repo()
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(stateDir)
    await prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: REPLACEMENT }],
    }))))
    await writeFile(join(r.dir, KEY), 'assert.equal(1, 1) // kept and edited\n')
    await writeFile(join(r.dir, REPLACEMENT), 'assert.equal(1, 1)\n')
    await commit(r.dir, 'original kept, replacement added')
    const contract = await loadActivation(activationPath(stateDir, TICKET))
    const problems = assetProblems(contract, await summarizeChanges(r.dir, r.baseSha)).join('; ')
    expect(problems).toContain('modified without authorization')
    expect(problems).not.toContain('deleted without authorization')
  })

  it('C1-MIG-06: a replacement outside allowedPaths or outside the acceptance item paths is rejected at prepare', async () => {
    const r = await repo()
    const outsideContract = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(outsideContract)
    await expect(prepareActivation(env(outsideContract, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: 'docs/notes.md' }],
    }))))).rejects.toThrow(/replacement docs\/notes.md, which is outside contract allowedPaths/)
    const outsideItem = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
    cleanup.push(outsideItem)
    await expect(prepareActivation(env(outsideItem, r.dir, r.baseSha, fence(card({
      protectedAssets: ['tests/acceptance/**'],
      paths: ['tests/**'],
      authorizes: [{ path: KEY, op: 'migrate', replacement: 'src/notes.js' }],
    }))))).rejects.toThrow(/replacement src\/notes.js, which is outside its own paths/)
  })

  it('C1-MIG-07: modify/delete authorizations must not carry a replacement', async () => {
    const r = await repo()
    for (const op of ['modify', 'delete'] as const) {
      const stateDir = await mkdtemp(join(tmpdir(), 'hephi-c1-state-'))
      cleanup.push(stateDir)
      await expect(prepareActivation(env(stateDir, r.dir, r.baseSha, fence(card({
        protectedAssets: ['tests/acceptance/**'],
        authorizes: [{ path: KEY, op, replacement: REPLACEMENT }],
      }))))).rejects.toThrow(/replacement is only valid with a migrate authorization/)
    }
  })
})
