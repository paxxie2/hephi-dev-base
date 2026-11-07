import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIVATION_VERSION, activationIntentPath, activationPath, canonicalPayload, contractHash, enforcementOf, executionModeOf, legacyContractHash, loadActivation, migrateActivationIntentSync, parseEnforcement, parseIssueExecutionMode, prepareActivation } from '../../src/control/activation.js'

async function stateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hephi-activation-'))
}

function enabledEnv(dir: string): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1',
    HEPHI_STATE_DIR: dir,
    HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["dubbo-common/**"]',
    HEPHI_TEST_COMMAND: 'mvn -pl dubbo-common test',
    HEPHI_REVERSE_TEST_COMMAND: 'mvn -pl dubbo-common -Dhephi.reverse=true test',
    DSH_SUPERAGENT_TICKET: 'ticket-1',
    DSH_SUPERAGENT_DIR: '/tmp/ticket-1',
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo',
    DSH_SUPERAGENT_GITHUB_NUMBER: '42',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({version:1,checks:[{id:'fixture-build',kind:'build',purpose:'fixture command',command:'true',args:[],cwd:'.',required:true,timeoutMs:5000,}]}),
  }
}

describe('HEPHI activation', () => {
  it('does nothing when the task is not explicitly enabled', async () => {
    await expect(prepareActivation({})).resolves.toEqual({ enabled: false, reason: 'not-requested' })
  })

  it('writes and reloads one hashed activation contract', async () => {
    const dir = await stateDir()
    const result = await prepareActivation(enabledEnv(dir))
    expect(result.enabled).toBe(true)
    if (!result.enabled) return
    const filePath = activationPath(dir, 'ticket-1')
    expect(await readFile(activationIntentPath(dir, 'ticket-1'), 'utf8')).toContain('ticket-1')
    expect(result.filePath).toBe(filePath)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ ticketId: 'ticket-1', issueNumber: 42 })
    await expect(loadActivation(filePath)).resolves.toEqual(result.contract)
    const { contractHash: hash, ...base } = result.contract
    expect(hash).toBe(contractHash(base))
  })

  it('fails closed when an enabled task lacks required context', async () => {
    const dir = await stateDir()
    await expect(prepareActivation({ HEPHI_ENABLED: '1', HEPHI_STATE_DIR: dir, DSH_SUPERAGENT_TICKET: 'ticket-1', HEPHI_VERIFICATION_CHECKS: JSON.stringify({version:1,checks:[{id:'fixture-build',kind:'build',purpose:'fixture command',command:'true',args:[],cwd:'.',required:true,timeoutMs:5000,}]}) })).rejects.toThrow('DSH_SUPERAGENT_GITHUB_REPOSITORY')
    await expect(readFile(activationIntentPath(dir, 'ticket-1'), 'utf8')).resolves.toContain('ticket-1')
  })

  it('rejects a tampered activation contract', async () => {
    const dir = await stateDir()
    const result = await prepareActivation(enabledEnv(dir))
    if (!result.enabled) throw new Error('activation was not enabled')
    const filePath = activationPath(dir, 'ticket-1')
    const value = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    value.baseSha = 'b'.repeat(40)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, `${JSON.stringify(value)}\n`))
    await expect(loadActivation(filePath)).rejects.toThrow('hash mismatch')
  })

  it('migrates an existing contract to an activation intent marker', async () => {
    const dir = await stateDir()
    await prepareActivation(enabledEnv(dir))
    await import('node:fs/promises').then(({ unlink }) => unlink(activationIntentPath(dir, 'ticket-1')))
    migrateActivationIntentSync(dir, 'ticket-1')
    await expect(readFile(activationIntentPath(dir, 'ticket-1'), 'utf8')).resolves.toContain('ticket-1')
  })
})

describe('HEPHI optional execution modes', () => {
  it('defaults to native, writes an explicit mode, and hashes staged differently', async () => {
    const nativeDir = await stateDir()
    const native = await prepareActivation(enabledEnv(nativeDir))
    if (!native.enabled) throw new Error('activation was not enabled')
    expect(native.contract.executionMode).toBe('native')
    expect(JSON.parse(await readFile(native.filePath, 'utf8'))).toMatchObject({ executionMode: 'native' })
    const staged = await prepareActivation({ ...enabledEnv(await stateDir()), HEPHI_EXECUTION_MODE: 'staged' })
    if (!staged.enabled) throw new Error('activation was not enabled')
    expect(staged.contract.executionMode).toBe('staged')
    expect(staged.contract.contractHash).not.toBe(native.contract.contractHash)
  })

  it('rejects an invalid environment mode before writing a contract', async () => {
    const dir = await stateDir()
    await expect(prepareActivation({ ...enabledEnv(dir), HEPHI_EXECUTION_MODE: 'parallel' })).rejects.toThrow('HEPHI_EXECUTION_MODE')
    await expect(readFile(activationPath(dir, 'ticket-1'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('loads a historical mode-less contract with its original hash and interprets it as native', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const filePath = activationPath(dir, 'ticket-1')
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    delete raw.executionMode
    delete raw.contractHash
    raw.contractHash = contractHash(raw as any)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`))
    const loaded = await loadActivation(filePath)
    expect(loaded.contractHash).toBe(raw.contractHash)
    expect(Object.hasOwn(loaded, 'executionMode')).toBe(false)
    expect(loaded.executionMode).toBeUndefined()
    expect(executionModeOf(loaded)).toBe('native')
    const { contractHash: loadedHash, ...loadedBase } = loaded
    expect(contractHash(loadedBase)).toBe(loadedHash)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(raw)
  })

  it('rejects a mode value only after validating the original hash', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const filePath = activationPath(dir, 'ticket-1')
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    raw.executionMode = 'parallel'
    // A raw hash over the invalid field proves hash validation precedes mode interpretation.
    delete raw.contractHash
    raw.contractHash = contractHash(raw as any)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, JSON.stringify(raw)))
    await expect(loadActivation(filePath)).rejects.toThrow('invalid executionMode')
    raw.executionMode = 'staged'
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, JSON.stringify(raw)))
    await expect(loadActivation(filePath)).rejects.toThrow('hash mismatch')
  })
})

describe('Issue execution mode marker', () => {
  it('selects exactly one explicit marker and rejects missing or conflicting markers', () => {
    expect(parseIssueExecutionMode('[native] implement site pnl')).toBe('native')
    expect(parseIssueExecutionMode('[staged] implement site pnl')).toBe('staged')
    expect(parseIssueExecutionMode('[NATIVE] case insensitive')).toBe('native')
    expect(() => parseIssueExecutionMode('implement site pnl')).toThrow('explicit [native] or [staged]')
    expect(() => parseIssueExecutionMode('[native] [staged] conflict')).toThrow('conflicting')
    expect(() => parseIssueExecutionMode('[native]', 'staged')).toThrow('conflicts')
    expect(parseIssueExecutionMode('[staged]', 'staged')).toBe('staged')
  })

  it('writes the title-selected mode into the new contract', async () => {
    const native = await prepareActivation({ ...enabledEnv(await stateDir()), HEPHI_ISSUE_TITLE: '[native] task' })
    if (!native.enabled) throw new Error('activation was not enabled')
    expect(native.contract.executionMode).toBe('native')
    const staged = await prepareActivation({ ...enabledEnv(await stateDir()), HEPHI_ISSUE_TITLE: '[staged] task' })
    if (!staged.enabled) throw new Error('activation was not enabled')
    expect(staged.contract.executionMode).toBe('staged')
    await expect(prepareActivation({ ...enabledEnv(await stateDir()), HEPHI_ISSUE_TITLE: '[native] task', HEPHI_EXECUTION_MODE: 'staged' })).rejects.toThrow('conflicts')
  })
})

describe('activation format versioning', () => {
  it('writes the explicit version and covers it in the contract hash', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    expect(prepared.contract.version).toBe(2)
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    expect(raw.version).toBe(2)
    const { contractHash: hash, ...base } = raw as Record<string, unknown> & { contractHash: string }
    expect(hash).toBe(contractHash(base as never))
    expect(contractHash({ ...base, version: 1 } as never)).not.toBe(hash)
  })

  it('rejects an unknown activation version at load time', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    raw.version = 3
    delete raw.contractHash
    raw.contractHash = legacyContractHash(raw as never)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(prepared.filePath, JSON.stringify(raw)))
    await expect(loadActivation(prepared.filePath)).rejects.toThrow('unsupported HEPHI activation version: 3')
  })

  it('rejects an unknown top-level field even when the stored hash matches it', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    raw.undeclaredPolicy = 'shadow'
    delete raw.contractHash
    raw.contractHash = contractHash(raw as never)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(prepared.filePath, JSON.stringify(raw)))
    await expect(loadActivation(prepared.filePath)).rejects.toThrow('unsupported HEPHI activation field: undeclaredPolicy')
  })

  it('loads a legacy contract written before versioning', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    delete raw.version
    delete raw.contractHash
    raw.contractHash = legacyContractHash(raw as never)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(prepared.filePath, JSON.stringify(raw)))
    const loaded = await loadActivation(prepared.filePath)
    expect(loaded.version).toBeUndefined()
    expect(Object.hasOwn(loaded, 'version')).toBe(false)
  })
})

describe('HEPHI enforcement mode', () => {
  it('defaults to enforce, writes an explicit mode and hashes shadow differently', async () => {
    const nativeDir = await stateDir()
    const enforced = await prepareActivation(enabledEnv(nativeDir))
    if (!enforced.enabled) throw new Error('activation was not enabled')
    expect(enforced.contract.enforcement).toBe('enforce')
    const shadow = await prepareActivation({ ...enabledEnv(await stateDir()), HEPHI_ENFORCEMENT: 'shadow' })
    if (!shadow.enabled) throw new Error('activation was not enabled')
    expect(shadow.contract.enforcement).toBe('shadow')
    expect(enforcementOf(shadow.contract)).toBe('shadow')
    expect(shadow.contract.contractHash).not.toBe(enforced.contract.contractHash)
    await expect(prepareActivation({ ...enabledEnv(await stateDir()), HEPHI_ENFORCEMENT: 'observe' })).rejects.toThrow('HEPHI_ENFORCEMENT')
  })

  it('loads a mode-less contract as enforce and rejects an invalid persisted value after the hash', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    delete raw.enforcement
    delete raw.contractHash
    raw.contractHash = contractHash(raw as never)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(prepared.filePath, JSON.stringify(raw)))
    const loaded = await loadActivation(prepared.filePath)
    expect(enforcementOf(loaded)).toBe('enforce')
    raw.enforcement = 'observe'
    delete raw.contractHash
    raw.contractHash = contractHash(raw as never)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(prepared.filePath, JSON.stringify(raw)))
    await expect(loadActivation(prepared.filePath)).rejects.toThrow('invalid enforcement')
  })

  it('parses the environment value explicitly', () => {
    expect(parseEnforcement(undefined)).toBe('enforce')
    expect(parseEnforcement('')).toBe('enforce')
    expect(parseEnforcement('shadow')).toBe('shadow')
    expect(parseEnforcement('enforce')).toBe('enforce')
    expect(() => parseEnforcement('on')).toThrow('HEPHI_ENFORCEMENT')
  })
})

describe('activation canonical hashing (R1)', () => {
  function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeys)
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value as Record<string, unknown>).reverse()) out[key] = reverseKeys((value as Record<string, unknown>)[key])
      return out
    }
    return value
  }
  function fixture(): Record<string, unknown> {
    return {
      version: 2, enabled: true, ticketId: 'ticket-1', repository: 'paxxie2/dubbo', issueNumber: 42,
      workspace: '/tmp/ticket-1', baseRef: 'main', baseSha: 'a'.repeat(40), allowedPaths: ['a/**', 'b/**'],
      requirePullRequest: false, executionMode: 'native', enforcement: 'enforce',
      plugin: { version: '0.1.0', commit: 'b'.repeat(40) },
      verification: { version: 1, checks: [{ id: 'build', kind: 'build', purpose: 'p', command: 'true', args: [], cwd: '.', required: true, timeoutMs: 5000 }] },
      task: { version: 1, goal: 'g', outOfScope: [], acceptance: [{ id: 'AC1', text: 't', check: 'build', paths: ['a/**'] }, { id: 'AC2', text: 't2', check: 'build', paths: ['b/**'] }], protect: ['**/tests/**'] },
    }
  }
  async function writeContract(filePath: string, value: Record<string, unknown>): Promise<void> {
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`))
  }
  async function prepared(): Promise<{ dir: string; filePath: string; raw: Record<string, unknown> }> {
    const dir = await stateDir()
    const result = await prepareActivation(enabledEnv(dir))
    if (!result.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(result.filePath, 'utf8')) as Record<string, unknown>
    return { dir, filePath: result.filePath, raw }
  }
  const withoutHash = (raw: Record<string, unknown>) => {
    const { contractHash: _ignored, ...rest } = raw
    return rest as never
  }

  it('R1-T01: top-level key order does not change the current hash', () => {
    const base = fixture()
    expect(contractHash(base as never)).toBe(contractHash(reverseKeys(base) as never))
    expect(canonicalPayload(base as never)).toBe(canonicalPayload(reverseKeys(base) as never))
  })

  it('R1-T02: nested key order does not change the current hash', () => {
    const base = fixture()
    expect(contractHash(base.plugin as never)).toBe(contractHash(reverseKeys(base.plugin) as never))
    expect(contractHash(base.verification as never)).toBe(contractHash(reverseKeys(base.verification) as never))
    expect(contractHash((base.task as Record<string, unknown>).acceptance as never)).toBe(contractHash(reverseKeys((base.task as Record<string, unknown>).acceptance) as never))
  })

  it('R1-T03: array order is preserved and changes the hash', () => {
    const base = fixture()
    const swappedPaths = { ...base, allowedPaths: ['b/**', 'a/**'] }
    expect(contractHash(swappedPaths as never)).not.toBe(contractHash(base as never))
    const acceptance = (base.task as Record<string, unknown>).acceptance as unknown[]
    const swappedAcceptance = { ...base, task: { ...(base.task as Record<string, unknown>), acceptance: [acceptance[1], acceptance[0]] } }
    expect(contractHash(swappedAcceptance as never)).not.toBe(contractHash(base as never))
  })

  it('R1-T04: semantic changes alter the hash and stale stored hashes are rejected', async () => {
    const base = fixture()
    expect(contractHash({ ...base, baseSha: 'c'.repeat(40) } as never)).not.toBe(contractHash(base as never))
    expect(contractHash({ ...base, enforcement: 'shadow' } as never)).not.toBe(contractHash(base as never))
    expect(contractHash({ ...base, allowedPaths: ['a/**'] } as never)).not.toBe(contractHash(base as never))
    const { filePath, raw } = await prepared()
    const tampered = { ...raw, baseSha: 'c'.repeat(40) }
    await writeContract(filePath, tampered)
    await expect(loadActivation(filePath)).rejects.toThrow('hash mismatch')
  })

  it('R1-T05: new contracts are version 2, canonical and tolerant of whitespace formatting', async () => {
    const { filePath, raw } = await prepared()
    expect(ACTIVATION_VERSION).toBe(2)
    expect(raw.version).toBe(2)
    expect(raw.contractHash).toBe(contractHash(withoutHash(raw)))
    const compact = JSON.stringify(raw)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, compact))
    const loaded = await loadActivation(filePath)
    expect(loaded.version).toBe(2)
    expect(loaded.contractHash).toBe(raw.contractHash)
  })

  it('R1-T06: version 1 contracts load unchanged with their historical hash', async () => {
    const { filePath, raw } = await prepared()
    const v1: Record<string, unknown> = { ...raw, version: 1 }
    delete v1.contractHash
    v1.contractHash = legacyContractHash(v1 as never)
    await writeContract(filePath, v1)
    const before = await readFile(filePath, 'utf8')
    const loaded = await loadActivation(filePath)
    expect(loaded.version).toBe(1)
    expect(loaded.contractHash).toBe(v1.contractHash)
    expect(await readFile(filePath, 'utf8')).toBe(before)
  })

  it('R1-T07: unversioned legacy contracts load unchanged and are never rewritten', async () => {
    const { filePath, raw } = await prepared()
    const legacy = { ...raw }
    delete legacy.version
    delete legacy.contractHash
    legacy.contractHash = legacyContractHash(legacy as never)
    await writeContract(filePath, legacy)
    const before = await readFile(filePath, 'utf8')
    const loaded = await loadActivation(filePath)
    expect(Object.hasOwn(loaded, 'version')).toBe(false)
    expect(loaded.contractHash).toBe(legacy.contractHash)
    expect(await readFile(filePath, 'utf8')).toBe(before)
  })

  it('R1-T08: a v1 contract with reordered keys and a canonical hash is rejected (no silent migration)', async () => {
    const { filePath, raw } = await prepared()
    const v1: Record<string, unknown> = { ...raw, version: 1 }
    delete v1.contractHash
    const reordered = reverseKeys(v1) as Record<string, unknown>
    reordered.contractHash = contractHash(reordered as never)
    await writeContract(filePath, reordered)
    await expect(loadActivation(filePath)).rejects.toThrow('hash mismatch')
  })

  it('R1-T09: unknown versions are rejected with re-prepare guidance', async () => {
    const { filePath, raw } = await prepared()
    const future: Record<string, unknown> = { ...raw, version: 3 }
    delete future.contractHash
    future.contractHash = legacyContractHash(future as never)
    await writeContract(filePath, future)
    await expect(loadActivation(filePath)).rejects.toThrow('unsupported HEPHI activation version: 3')
    await expect(loadActivation(filePath)).rejects.toThrow(/re-prepare a new contract/)
  })

  it('R1-T10: unknown top-level fields are still rejected with a matching canonical hash', async () => {
    const { filePath, raw } = await prepared()
    const extended: Record<string, unknown> = { ...raw, extraPolicy: 'anything' }
    delete extended.contractHash
    extended.contractHash = contractHash(extended as never)
    await writeContract(filePath, extended)
    await expect(loadActivation(filePath)).rejects.toThrow('unsupported HEPHI activation field: extraPolicy')
  })

  it('R1-T11: stored hash is validated before an invalid mode is interpreted', async () => {
    const { filePath, raw } = await prepared()
    const invalid: Record<string, unknown> = { ...raw, executionMode: 'parallel' }
    const staleHash = contractHash({ ...raw, executionMode: 'native' } as never)
    invalid.contractHash = staleHash
    await writeContract(filePath, invalid)
    await expect(loadActivation(filePath)).rejects.toThrow('hash mismatch')
  })

  it('R1-T12: fixed fixture matches the independently computed canonical SHA256', () => {
    // Independent implementation: Python json.dumps(canonical, ensure_ascii=False, separators=(',',':'))
    // with recursive key sorting and array order preserved; expected hash registered before implementation.
    const fixed = {
      enabled: true, ticketId: 'T-中文 1', repository: 'paxxie2/dubbo', issueNumber: 42,
      workspace: '/tmp/work space/中文', baseRef: 'main', baseSha: 'a'.repeat(40),
      allowedPaths: ['src/**', '文档/**'], requirePullRequest: true, executionMode: 'native', enforcement: 'enforce',
      plugin: { version: '0.1.0', commit: 'b'.repeat(40) },
      verification: { version: 1, checks: [{ id: 'unit', kind: 'test', purpose: 'purpose 中文', command: 'node', args: ['-e', 'console.log("hi")'], cwd: '.', required: true, timeoutMs: 1000 }] },
      task: { version: 1, goal: '目标 中文', outOfScope: [], acceptance: [{ id: 'AC1', text: '文本 with space', check: 'unit', paths: ['src/**'] }], protect: ['**/tests/**'] },
      version: 2,
    }
    expect(contractHash(fixed as never)).toBe('sha256:14756a3ee1178fcbb8170983322ceb954c9661d8744af15a02ea9761fa1b5c50')
  })
})
