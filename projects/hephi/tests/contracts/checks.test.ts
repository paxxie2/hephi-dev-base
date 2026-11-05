import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVerificationConfig, type VerificationCheck } from '../../src/contracts/checks.js'
import { activationPath, contractHash, loadActivation, prepareActivation } from '../../src/control/activation.js'

const build: VerificationCheck = {
  id: 'build', kind: 'build', purpose: 'compile the project', command: 'true', args: [],
  cwd: '.', required: true, timeoutMs: 5000
}
const test: VerificationCheck = {
  id: 'unit', kind: 'test', purpose: 'prove the fix', command: 'pytest', args: ['-q'],
  cwd: '.', required: true, timeoutMs: 5000,

}
describe('frozen verification configuration', () => {
  it('accepts explicit passing checks', () => {
    expect(parseVerificationConfig({ version: 1, checks: [build, test] }).checks).toHaveLength(2)
  })
  it('rejects unsupported outcomes and unsafe or empty coverage', () => {
    for (const changes of [{ expect: 'reproduce' }, { baseline: 'HEAD' }, { parser: 'exit' }, { cwd: '../x' }, { reportPaths: ['x.xml'] }]) {
      expect(() => parseVerificationConfig({ version: 1, checks: [{ ...test, ...changes }] })).toThrow()
    }
    expect(() => parseVerificationConfig({ version: 1, checks: [build, build] })).toThrow()
    expect(() => parseVerificationConfig({ version: 1, checks: [{ ...build, required: false }] })).toThrow()
  })
})

function env(stateDir: string): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1', HEPHI_STATE_DIR: stateDir, HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["src/**"]',
    DSH_SUPERAGENT_TICKET: 'ticket-1', DSH_SUPERAGENT_DIR: '/tmp/ticket-1',
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo', DSH_SUPERAGENT_GITHUB_NUMBER: '42',
  }
}

describe('activation verification loading', () => {
  it('loads checks from an explicit file and hashes them into the contract without legacy commands', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-checks-'))
    const file = join(stateDir, 'checks.json')
    await writeFile(file, JSON.stringify({ version: 1, checks: [build, test] }))
    const prepared = await prepareActivation({ ...env(stateDir), HEPHI_VERIFICATION_FILE: file })
    if (!prepared.enabled) throw new Error('activation was not enabled')
    expect(prepared.contract.verification?.checks).toHaveLength(2)
    const loaded = await loadActivation(activationPath(stateDir, 'ticket-1'))
    expect(loaded.contractHash).toBe(prepared.contract.contractHash)
    expect(loaded.verification?.checks[1]).toMatchObject({ id: 'unit', kind: 'test' })
  })

  it('requires an explicit verification configuration for a new contract', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-checks-'))
    await expect(prepareActivation(env(stateDir))).rejects.toThrow(/HEPHI_VERIFICATION_FILE or HEPHI_VERIFICATION_CHECKS/)
  })

  it('rejects a contract without mandatory checks at load time', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-checks-'))
    const file = join(stateDir, 'legacy.json')
    const payload = {
      enabled: true, ticketId: 'ticket-legacy', repository: 'paxxie2/dubbo', issueNumber: 1,
      workspace: '/tmp/ticket-legacy', baseRef: 'main', baseSha: 'b'.repeat(40), allowedPaths: ['**'],
    }
    await writeFile(file, JSON.stringify({ ...payload, contractHash: contractHash(payload as never) }))
    await expect(loadActivation(file)).rejects.toThrow()
  })
})
