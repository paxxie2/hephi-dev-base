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

// ---- N2/N4 加固：命令位、前缀、shell -c、引号与离线例外 ---------------------

const REJECT_PREFIX = /^HEPHI offline environment is not satisfied: check "fixture-build" runs a non-offline command \(/

const rejectFamilies: Array<{ name: string; command: string; args: string[]; expected: RegExp }> = [
  { name: 'npm install', command: 'npm', args: ['install', 'left-pad'], expected: /npm install without --offline/ },
  { name: 'npm exec', command: 'npm', args: ['exec', 'left-pad'], expected: /npm exec can download packages/ },
  { name: 'npm create', command: 'npm', args: ['create', 'vite'], expected: /npm create can download packages/ },
  { name: 'pnpm add', command: 'pnpm', args: ['add', 'left-pad'], expected: /pnpm install without --frozen-lockfile/ },
  { name: 'pnpm dlx', command: 'pnpm', args: ['dlx', 'create-x'], expected: /pnpm dlx downloads packages/ },
  { name: 'npx', command: 'npx', args: ['left-pad'], expected: /npx can download packages/ },
  { name: 'yarn add', command: 'yarn', args: ['add', 'left-pad'], expected: /yarn add without an offline\/frozen flag/ },
  { name: 'yarn dlx', command: 'yarn', args: ['dlx', 'create-x'], expected: /yarn dlx downloads packages/ },
  { name: 'bun add', command: 'bun', args: ['add', 'left-pad'], expected: /bun add\/install can download/ },
  { name: 'bun x', command: 'bun', args: ['x', 'left-pad'], expected: /bun x can download packages/ },
  { name: 'bunx', command: 'bunx', args: ['left-pad'], expected: /bunx can download packages/ },
  { name: 'pip install', command: 'pip', args: ['install', 'left-pad'], expected: /pip install without --no-index/ },
  { name: 'pipx run', command: 'pipx', args: ['run', 'left-pad'], expected: /pipx run\/install can download/ },
  { name: 'poetry add', command: 'poetry', args: ['add', 'left-pad'], expected: /poetry add\/install can download/ },
  { name: 'uv pip', command: 'uv', args: ['pip', 'install', 'left-pad'], expected: /uv add\/pip\/run can download/ },
  { name: 'uvx', command: 'uvx', args: ['left-pad'], expected: /uvx can download packages/ },
  { name: 'go install', command: 'go', args: ['install', 'example.com/x@latest'], expected: /go install fetches modules/ },
  { name: 'cargo install', command: 'cargo', args: ['install', 'ripgrep'], expected: /cargo install can download crates/ },
  { name: 'corepack prepare', command: 'corepack', args: ['prepare', 'pnpm@9'], expected: /corepack prepare downloads/ },
  { name: 'git clone', command: 'git', args: ['clone', 'https://example.invalid/x.git'], expected: /git clone is a networked command/ },
  { name: 'curl', command: 'curl', args: ['-fsS', 'https://example.invalid'], expected: /curl\/wget are networked commands/ },
  { name: 'wget', command: 'wget', args: ['https://example.invalid'], expected: /curl\/wget are networked commands/ },
]

describe('C4.6 offline scan N2/N4: command families', () => {
  it.each(rejectFamilies)('OS-17 rejects $name at the command position', async ({ command, args, expected }) => {
    const { stateDir, workspace } = await fixtures()
    const attempt = prepareActivation(env(stateDir, workspace, [check(command, args)], OFFLINE))
    await expect(attempt).rejects.toThrow(REJECT_PREFIX)
    await expect(attempt).rejects.toThrow(expected)
  })
})

const offlineAccept: Array<{ name: string; command: string; args: string[] }> = [
  { name: 'node script', command: 'node', args: ['build.mjs'] },
  { name: 'pnpm test', command: 'pnpm', args: ['test'] },
  { name: 'pnpm install --frozen-lockfile', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { name: 'pnpm install --offline', command: 'pnpm', args: ['install', '--offline'] },
  { name: 'npm ci', command: 'npm', args: ['ci'] },
  { name: 'npm install --offline', command: 'npm', args: ['install', '--offline'] },
  { name: 'yarn add --offline', command: 'yarn', args: ['add', '--offline', 'left-pad'] },
  { name: 'pip install --no-index', command: 'pip', args: ['install', '--no-index', 'left-pad'] },
  { name: 'pip download --no-index', command: 'pip', args: ['download', '--no-index', 'left-pad'] },
  { name: 'mvn -o', command: 'mvn', args: ['-o', 'test'] },
  { name: 'gradle --offline', command: 'gradle', args: ['--offline', 'build'] },
  { name: 'go test', command: 'go', args: ['test', './...'] },
  { name: 'cargo test', command: 'cargo', args: ['test'] },
  { name: 'git log', command: 'git', args: ['log', '--oneline'] },
  { name: 'uv --version', command: 'uv', args: ['--version'] },
]

describe('C4.6 offline scan N2/N4: genuine offline commands', () => {
  it.each(offlineAccept)('OS-OK-14 accepts $name under offline=true', async ({ command, args }) => {
    const { stateDir, workspace } = await fixtures()
    const prepared = await prepareActivation(env(stateDir, workspace, [check(command, args)], OFFLINE))
    expect(prepared.enabled).toBe(true)
  })
})

const shellWrappers: Array<{ name: string; command: string; args: string[]; expected: RegExp }> = [
  { name: 'sh -c pnpm', command: 'sh', args: ['-c', 'pnpm install'], expected: /pnpm install without --frozen-lockfile/ },
  { name: 'bash -c &&', command: 'bash', args: ['-c', 'cd repo && uv add left-pad'], expected: /uv add\/pip\/run can download/ },
  { name: 'zsh -c ;', command: 'zsh', args: ['-c', 'echo ok; npm install left-pad'], expected: /npm install without --offline/ },
  { name: 'nested sh -c', command: 'sh', args: ['-c', 'sh -c "npm install left-pad"'], expected: /npm install without --offline/ },
  { name: 'sh -c pipe', command: 'sh', args: ['-c', 'true | npx left-pad'], expected: /npx can download packages/ },
]

describe('C4.6 offline scan N2/N4: shell -c recursion', () => {
  it.each(shellWrappers)('OS-SH scans the $name payload recursively', async ({ command, args, expected }) => {
    const { stateDir, workspace } = await fixtures()
    const attempt = prepareActivation(env(stateDir, workspace, [check(command, args)], OFFLINE))
    await expect(attempt).rejects.toThrow(REJECT_PREFIX)
    await expect(attempt).rejects.toThrow(expected)
  })
})

describe('C4.6 offline scan N2/N4: false-positive guards and prefixes', () => {
  it.each([
    { name: 'filename containing npx', command: 'node', args: ['scripts/npx-report.mjs'] },
    { name: 'grep pattern containing yarn add', command: 'git', args: ['log', '--grep', 'yarn add'] },
    { name: 'quoted text in a shell payload', command: 'bash', args: ['-c', 'echo "go get"'] },
    { name: 'diagnostic printing a command', command: 'echo', args: ['npm install'] },
    { name: 'printf format argument', command: 'printf', args: ['%s', 'npm install'] },
  ])('OS-FP-04 does not flag $name', async ({ command, args }) => {
    const { stateDir, workspace } = await fixtures()
    const prepared = await prepareActivation(env(stateDir, workspace, [check(command, args)], OFFLINE))
    expect(prepared.enabled).toBe(true)
  })

  it.each([
    { name: 'env assignment', command: 'env', args: ['CI=1', 'npm', 'install', 'left-pad'], expected: /npm install without --offline/ },
    { name: 'env option', command: 'env', args: ['-i', 'npm', 'install', 'left-pad'], expected: /npm install without --offline/ },
    { name: 'sudo prefix', command: 'sudo', args: ['npm', 'install', 'left-pad'], expected: /npm install without --offline/ },
    { name: 'nohup wrapper', command: 'nohup', args: ['sh', '-c', 'yarn add left-pad'], expected: /yarn add without an offline\/frozen flag/ },
  ])('OS-PREFIX strips a leading $name before scanning the command', async ({ command, args, expected }) => {
    const { stateDir, workspace } = await fixtures()
    const attempt = prepareActivation(env(stateDir, workspace, [check(command, args)], OFFLINE))
    await expect(attempt).rejects.toThrow(REJECT_PREFIX)
    await expect(attempt).rejects.toThrow(expected)
  })

  it('OS-MULTI lists every offending check and command before writing a contract', async () => {
    const { stateDir, workspace } = await fixtures()
    const checks: Check[] = [
      check('pipx', ['run', 'left-pad'], 'fixture-pipx'),
      { ...check('uvx', ['left-pad']), id: 'fixture-uvx' },
      { ...check('git', ['clone', 'https://example.invalid/x']), id: 'fixture-clone' },
    ]
    const attempt = prepareActivation(env(stateDir, workspace, checks, OFFLINE))
    await expect(attempt).rejects.toThrow('check "fixture-pipx"')
    await expect(attempt).rejects.toThrow('check "fixture-uvx"')
    await expect(attempt).rejects.toThrow('check "fixture-clone"')
    await expect(attempt).rejects.toThrow(/pipx run\/install/)
    await expect(attempt).rejects.toThrow(/uvx can download/)
    await expect(attempt).rejects.toThrow(/git clone is a networked command/)
    expect(existsSync(activationPath(stateDir, TICKET))).toBe(false)
  })
})
