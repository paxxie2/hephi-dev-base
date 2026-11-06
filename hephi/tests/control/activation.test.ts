import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activationIntentPath, activationPath, contractHash, enforcementOf, executionModeOf, loadActivation, migrateActivationIntentSync, parseEnforcement, parseIssueExecutionMode, prepareActivation } from '../../src/control/activation.js'

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
    expect(prepared.contract.version).toBe(1)
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    expect(raw.version).toBe(1)
    const { contractHash: hash, ...base } = raw as Record<string, unknown> & { contractHash: string }
    expect(hash).toBe(contractHash(base as never))
    expect(contractHash({ ...base, version: 2 } as never)).not.toBe(hash)
  })

  it('rejects an unknown activation version at load time', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    raw.version = 2
    delete raw.contractHash
    raw.contractHash = contractHash(raw as never)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(prepared.filePath, JSON.stringify(raw)))
    await expect(loadActivation(prepared.filePath)).rejects.toThrow('unsupported HEPHI activation version: 2')
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
    raw.contractHash = contractHash(raw as never)
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
