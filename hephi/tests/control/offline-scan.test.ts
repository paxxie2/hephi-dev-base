import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activationPath, prepareActivation } from '../../src/control/activation.js'

/**
 * PR #25 independent review M4: the C4.6 offline command scan used to be a narrow
 * blacklist, so the eight commands reproduced by the reviewer were silently accepted.
 * These are real `prepareActivation` runs (no mock): offline=true + an existing lockfile,
 * each command must fail and the error must list the check and the command.
 */

const TICKET = 'ticket-1'

interface Check { id: string; kind: 'build' | 'test'; purpose: string; command: string; args: string[]; cwd: string; required: boolean; timeoutMs: number }
const check = (command: string, args: string[] = [], id = 'fixture-build'): Check =>
  ({ id, kind: 'build', purpose: 'fixture command', command, args, cwd: '.', required: true, timeoutMs: 5000 })

async function fixtures(): Promise<{ stateDir: string; workspace: string }> {
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-offline-scan-state-'))
  const workspace = await mkdtemp(join(tmpdir(), 'hephi-offline-scan-workspace-'))
  await mkdir(join(workspace, 'nested'), { recursive: true })
  await writeFile(join(workspace, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  return { stateDir, workspace }
}

function env(stateDir: string, workspace: string, checks: Check[], environment?: Record<string, unknown>): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1',
    HEPHI_STATE_DIR: stateDir,
    HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["dubbo-common/**"]',
    DSH_SUPERAGENT_TICKET: TICKET,
    DSH_SUPERAGENT_DIR: workspace,
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo',
    DSH_SUPERAGENT_GITHUB_NUMBER: '42',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({ version: 1, checks, ...(environment === undefined ? {} : { environment }) }),
  }
}

const OFFLINE = { offline: true, lockfile: 'pnpm-lock.yaml' }

const bypassCases: Array<{ command: string; args: string[]; expected: RegExp }> = [
  { command: 'yarn', args: ['add', 'left-pad'], expected: /yarn add without an offline\/frozen flag/ },
  { command: 'pnpm', args: ['dlx', 'create-something'], expected: /pnpm dlx downloads packages from the network/ },
  { command: 'npx', args: ['--yes', 'left-pad'], expected: /npx can download packages from the network/ },
  { command: 'bun', args: ['add', 'left-pad'], expected: /bun add\/install can download packages from the network/ },
  { command: 'bun', args: ['install'], expected: /bun add\/install can download packages from the network/ },
  { command: 'pip', args: ['download', 'left-pad'], expected: /pip download fetches packages from the network/ },
  { command: 'go', args: ['get', 'example.com/x'], expected: /go get fetches modules from the network/ },
  { command: 'npm', args: ['exec', 'left-pad'], expected: /npm exec can download packages from the network/ },
  { command: 'corepack', args: ['prepare', 'pnpm@9'], expected: /corepack prepare downloads package managers from the network/ },
  // Equivalent pre-existing patterns must keep failing too.
  { command: 'npm', args: ['i', 'left-pad'], expected: /npm install without --offline/ },
  { command: 'yarn', args: ['install'], expected: /yarn install without an offline\/frozen flag/ },
]

describe('C4.6 prepare-time offline scan (PR #25 M4 regressions)', () => {
  it.each(bypassCases)('rejects "$command $args" under offline=true and names the check and command', async ({ command, args, expected }) => {
    const { stateDir, workspace } = await fixtures()
    const attempt = prepareActivation(env(stateDir, workspace, [check(command, args)], OFFLINE))
    await expect(attempt).rejects.toThrow('HEPHI offline environment is not satisfied')
    await expect(attempt).rejects.toThrow('check "fixture-build"')
    await expect(attempt).rejects.toThrow(expected)
    await expect(attempt).rejects.toThrow(`${command} ${args.join(' ')}`)
    expect(existsSync(activationPath(stateDir, TICKET))).toBe(false)
  })

  it('rejects wrapped network commands (sh -c) as well', async () => {
    const { stateDir, workspace } = await fixtures()
    const attempt = prepareActivation(env(stateDir, workspace, [check('sh', ['-c', 'yarn add left-pad'])], OFFLINE))
    await expect(attempt).rejects.toThrow('check "fixture-build"')
    await expect(attempt).rejects.toThrow(/yarn add without an offline\/frozen flag/)
  })

  it('lists every offending check and command in one failure', async () => {
    const { stateDir, workspace } = await fixtures()
    const checks: Check[] = [
      check('npx', ['left-pad']),
      { ...check('go', ['get', 'example.com/x']), id: 'fixture-test' },
    ]
    const attempt = prepareActivation(env(stateDir, workspace, checks, OFFLINE))
    await expect(attempt).rejects.toThrow('check "fixture-build"')
    await expect(attempt).rejects.toThrow('check "fixture-test"')
    await expect(attempt).rejects.toThrow(/npx can download/)
    await expect(attempt).rejects.toThrow(/go get fetches/)
  })

  it('accepts ordinary offline check commands', async () => {
    const { stateDir, workspace } = await fixtures()
    const checks: Check[] = [
      check('pnpm', ['test'], 'fixture-pnpm'),
      check('mvn', ['-o', 'test'], 'fixture-mvn'),
      check('gradle', ['--offline', 'build'], 'fixture-gradle'),
      check('yarn', ['test'], 'fixture-yarn'),
      check('go', ['test', './...'], 'fixture-go'),
      check('pip', ['list'], 'fixture-pip'),
      check('corepack', ['--version'], 'fixture-corepack'),
      check('node', ['build.mjs'], 'fixture-node'),
    ]
    const prepared = await prepareActivation(env(stateDir, workspace, checks, OFFLINE))
    expect(prepared.enabled).toBe(true)
  })

  it('does not intercept these commands when environment is undeclared', async () => {
    const { stateDir, workspace } = await fixtures()
    const prepared = await prepareActivation(env(stateDir, workspace, [check('yarn', ['add', 'left-pad'])]))
    expect(prepared.enabled).toBe(true)
  })

  it('does not intercept these commands when offline is false', async () => {
    const { stateDir, workspace } = await fixtures()
    const prepared = await prepareActivation(env(stateDir, workspace, [check('npx', ['left-pad'])], { offline: false }))
    expect(prepared.enabled).toBe(true)
  })
})
