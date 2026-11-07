import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTIVATION_VERSION, activationPath, contractHash, loadActivation, prepareActivation,
} from '../../src/control/activation.js'

const TICKET = 'ticket-1'

interface Check { id: string; kind: 'build' | 'test'; purpose: string; command: string; args: string[]; cwd: string; required: boolean; timeoutMs: number }
const check = (id: string, command: string, args: string[] = [], kind: Check['kind'] = 'build'): Check =>
  ({ id, kind, purpose: `${id} command`, command, args, cwd: '.', required: true, timeoutMs: 5000 })

async function dirs(): Promise<{ stateDir: string; workspace: string }> {
  return {
    stateDir: await mkdtemp(join(tmpdir(), 'hephi-offline-state-')),
    workspace: await mkdtemp(join(tmpdir(), 'hephi-offline-workspace-')),
  }
}

async function createLockfile(workspace: string, lockfile = 'pnpm-lock.yaml'): Promise<void> {
  const path = join(workspace, lockfile)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'lockfileVersion: 9\n')
}

function env(stateDir: string, workspace: string, verification: unknown): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1',
    HEPHI_STATE_DIR: stateDir,
    HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["dubbo-common/**"]',
    DSH_SUPERAGENT_TICKET: TICKET,
    DSH_SUPERAGENT_DIR: workspace,
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo',
    DSH_SUPERAGENT_GITHUB_NUMBER: '42',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify(verification),
  }
}

function config(checks: Check[], environment?: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, checks, ...(environment === undefined ? {} : { environment }) }
}

function withoutHash(raw: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...raw }
  delete copy.contractHash
  return copy
}

const OFFLINE_PNPM = { offline: true, lockfile: 'pnpm-lock.yaml' }

describe('C4.6 prepare-time offline environment enforcement', () => {
  it('accepts a declared offline environment with a lockfile and offline commands, frozen in the contract hash', async () => {
    const { stateDir, workspace } = await dirs()
    await createLockfile(workspace)
    const verification = config([
      check('fixture-build', 'pnpm', ['install', '--frozen-lockfile', '--offline']),
      check('fixture-test', 'true'),
    ], OFFLINE_PNPM)
    const prepared = await prepareActivation(env(stateDir, workspace, verification))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    // Additive verification field: the contract format version does not change.
    expect(ACTIVATION_VERSION).toBe(5)
    expect(prepared.contract.version).toBe(5)
    expect(prepared.contract.verification.environment).toEqual(OFFLINE_PNPM)
    const raw = JSON.parse(await readFile(activationPath(stateDir, TICKET), 'utf8')) as Record<string, unknown>
    expect(raw.contractHash).toBe(contractHash(withoutHash(raw) as never))
    await expect(loadActivation(prepared.filePath)).resolves.toEqual(prepared.contract)
  })

  it('accepts a lockfile in a workspace subdirectory', async () => {
    const { stateDir, workspace } = await dirs()
    await createLockfile(workspace, 'service/pnpm-lock.yaml')
    const verification = config([check('fixture-build', 'true')], { offline: true, lockfile: 'service/pnpm-lock.yaml' })
    const prepared = await prepareActivation(env(stateDir, workspace, verification))
    expect(prepared.enabled).toBe(true)
  })

  it('fails when the declared lockfile is missing and does not write a contract', async () => {
    const { stateDir, workspace } = await dirs()
    const verification = config([check('fixture-build', 'true')], OFFLINE_PNPM)
    await expect(prepareActivation(env(stateDir, workspace, verification))).rejects.toThrow('lockfile not found in the workspace: pnpm-lock.yaml')
    expect(existsSync(activationPath(stateDir, TICKET))).toBe(false)
  })

  it('fails clearly when the workspace directory does not exist', async () => {
    const { stateDir, workspace } = await dirs()
    const missing = join(workspace, 'does-not-exist')
    const verification = config([check('fixture-build', 'true')], OFFLINE_PNPM)
    await expect(prepareActivation(env(stateDir, missing, verification))).rejects.toThrow('workspace directory not found')
  })

  it('rejects networked install commands and lists every hit by check id and command', async () => {
    const cases: Array<{ command: string; args: string[]; expected: RegExp }> = [
      { command: 'npm', args: ['install'], expected: /npm install without --offline/ },
      { command: 'pnpm', args: ['install'], expected: /pnpm install without --frozen-lockfile or --offline/ },
      { command: 'mvn', args: ['-pl', 'dubbo-common', 'test'], expected: /mvn without -o\/--offline/ },
      { command: 'mvnw', args: ['test'], expected: /mvn without -o\/--offline/ },
      { command: 'gradle', args: ['test'], expected: /gradle without --offline/ },
      { command: './gradlew', args: ['build'], expected: /gradle without --offline/ },
      { command: 'yarn', args: ['install'], expected: /yarn install without an offline\/frozen flag/ },
      { command: 'pip', args: ['install', '-r', 'requirements.txt'], expected: /pip install without --no-index/ },
      { command: 'git', args: ['clone', 'https://github.com/example/repo'], expected: /git clone is a networked command/ },
      { command: 'curl', args: ['https://example.invalid/x'], expected: /curl\/wget are networked commands/ },
      { command: 'wget', args: ['https://example.invalid/x'], expected: /curl\/wget are networked commands/ },
    ]
    for (const entry of cases) {
      const { stateDir, workspace } = await dirs()
      await createLockfile(workspace)
      const verification = config([check('fixture-build', entry.command, entry.args)], OFFLINE_PNPM)
      const attempt = prepareActivation(env(stateDir, workspace, verification))
      await expect(attempt).rejects.toThrow('HEPHI offline environment is not satisfied')
      await expect(attempt).rejects.toThrow('check "fixture-build"')
      await expect(attempt).rejects.toThrow(entry.expected)
      expect(existsSync(activationPath(stateDir, TICKET))).toBe(false)
    }
  })

  it('lists all offending checks in one failure', async () => {
    const { stateDir, workspace } = await dirs()
    await createLockfile(workspace)
    const verification = config([
      check('fixture-build', 'pnpm', ['install']),
      check('fixture-test', 'mvn', ['test']),
    ], OFFLINE_PNPM)
    const attempt = prepareActivation(env(stateDir, workspace, verification))
    await expect(attempt).rejects.toThrow('check "fixture-build"')
    await expect(attempt).rejects.toThrow('check "fixture-test"')
    await expect(attempt).rejects.toThrow('pnpm install without')
    await expect(attempt).rejects.toThrow('mvn without')
  })

  it('accepts offline variants of each ecosystem command', async () => {
    const { stateDir, workspace } = await dirs()
    await createLockfile(workspace)
    const verification = config([
      check('fixture-build', 'npm', ['ci', '--offline']),
      check('fixture-java', 'mvn', ['-o', 'test']),
      check('fixture-gradle', './gradlew', ['--offline', 'build']),
      check('fixture-python', 'pip', ['install', '--no-index', '--find-links', 'wheels']),
      check('fixture-yarn', 'yarn', ['install', '--offline']),
      check('fixture-git', 'git', ['status']),
    ], OFFLINE_PNPM)
    const prepared = await prepareActivation(env(stateDir, workspace, verification))
    expect(prepared.enabled).toBe(true)
  })

  it('does not enforce when environment is undeclared (legacy behavior)', async () => {
    const { stateDir, workspace } = await dirs()
    const verification = config([check('fixture-build', 'pnpm', ['install'])])
    const prepared = await prepareActivation(env(stateDir, workspace, verification))
    expect(prepared.enabled).toBe(true)
  })

  it('does not enforce when offline is false, but still freezes the declared block', async () => {
    const { stateDir, workspace } = await dirs()
    const verification = config([check('fixture-build', 'pnpm', ['install'])], { offline: false, lockfile: 'missing.lock' })
    const prepared = await prepareActivation(env(stateDir, workspace, verification))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    expect(prepared.contract.verification.environment).toEqual({ offline: false, lockfile: 'missing.lock' })
  })

  it('validates the environment schema (offline type, lockfile required/relative, unknown fields)', async () => {
    const failures: Array<Record<string, unknown>> = [
      { offline: true }, // lockfile required
      { offline: true, lockfile: '../outside.lock' }, // must be workspace-relative
      { offline: 'yes', lockfile: 'pnpm-lock.yaml' }, // offline must be boolean
      { offline: true, lockfile: 'pnpm-lock.yaml', extra: 1 }, // unknown field is rejected
    ]
    for (const environment of failures) {
      const { stateDir, workspace } = await dirs()
      await createLockfile(workspace)
      await expect(prepareActivation(env(stateDir, workspace, config([check('fixture-build', 'true')], environment)))).rejects.toThrow()
    }
  })

  it('covers environment in the contract hash (tampering is rejected)', async () => {
    const { stateDir, workspace } = await dirs()
    await createLockfile(workspace)
    const prepared = await prepareActivation(env(stateDir, workspace, config([check('fixture-build', 'true')], OFFLINE_PNPM)))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    const raw = JSON.parse(await readFile(prepared.filePath, 'utf8')) as Record<string, unknown>
    const verification = raw.verification as Record<string, unknown>
    raw.verification = { ...verification, environment: { offline: false } }
    await writeFile(prepared.filePath, `${JSON.stringify(raw, null, 2)}\n`)
    await expect(loadActivation(prepared.filePath)).rejects.toThrow('hash mismatch')
  })
})
