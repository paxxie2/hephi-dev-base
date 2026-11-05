import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { parseIssueTask } from '../../src/contracts/task.js'
import { frozenTestDir, loadActivation, prepareActivation } from '../../src/control/activation.js'
import { mountWorkerGate } from '../../src/control/worker-mount.js'
import { sha256 } from '../../src/verification/fingerprint.js'

const card = {
  version: 1,
  goal: 'total() returns the sum of its two arguments',
  outOfScope: ['pricing rules', 'module layout'],
  acceptance: [{ id: 'AC1', text: 'total(2, 3) is 5', check: 'tests', paths: ['src/price.js', 'tests/price*.sh'], tests: ['tests/price*.sh'] }],
  budget: { maxFiles: 3, maxChangedLines: 40 },
}
const frozen = 'node -e "process.exit(require(\'./src/price.js\').total(2, 3) === 5 ? 0 : 1)"'
const body = [
  'total() subtracts instead of adding.', '',
  '```hephi-task', JSON.stringify(card, null, 2), '```', '',
  '```hephi-test AC1 tests/hephi/AC1.test.sh', frozen, '```',
].join('\n')

function env(stateDir: string, issueBody?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1', HEPHI_STATE_DIR: stateDir, HEPHI_BASE_COMMIT: 'a'.repeat(40), HEPHI_ALLOWED_PATHS: 'src/**,tests/**',
    DSH_SUPERAGENT_TICKET: 'ticket-1', DSH_SUPERAGENT_DIR: '/tmp/ticket-1',
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'example/probe', DSH_SUPERAGENT_GITHUB_NUMBER: '7',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({ version: 1, checks: [{ id: 'tests', kind: 'test', purpose: 'project tests', command: 'sh', args: ['run-tests.sh'] }] }),
    ...(issueBody === undefined ? {} : { HEPHI_ISSUE_BODY: issueBody }),
    ...extra,
  }
}

describe('Issue task card', () => {
  it('parses the card and binds frozen tests by content hash', () => {
    const task = parseIssueTask(body)!
    expect(task.card.goal).toBe(card.goal)
    expect(task.card.acceptance[0].frozen).toEqual([{ path: 'tests/hephi/AC1.test.sh', sha256: sha256(`${frozen}\n`) }])
    expect(task.card.allowRenames).toBe(false)
    expect(task.card.protect).toContain('**/tests/**')
    expect(task.frozenFiles.get('tests/hephi/AC1.test.sh')?.content).toBe(`${frozen}\n`)
  })

  it('rejects ambiguous or unverifiable cards', () => {
    expect(parseIssueTask('no card here')).toBeUndefined()
    expect(() => parseIssueTask('```hephi-test AC1 t.sh\nexit 0\n```')).toThrow('require a hephi-task')
    expect(() => parseIssueTask(body.replace('AC1 tests/hephi', 'AC9 tests/hephi'))).toThrow('unknown acceptance item AC9')
    const declared = { ...card, acceptance: [{ ...card.acceptance[0], frozen: [{ path: 'x', sha256: `sha256:${'0'.repeat(64)}` }] }] }
    expect(() => parseIssueTask(`\`\`\`hephi-task\n${JSON.stringify(declared)}\n\`\`\``)).toThrow('only through hephi-test')
    const unproven = { ...card, acceptance: [{ ...card.acceptance[0], tests: [] }] }
    expect(() => parseIssueTask(`\`\`\`hephi-task\n${JSON.stringify(unproven)}\n\`\`\``)).toThrow('frozen tests or Worker test globs')
    const unbudgeted = { ...card, budget: undefined }
    expect(() => parseIssueTask(`\`\`\`hephi-task\n${JSON.stringify(unbudgeted)}\n\`\`\``)).toThrow()
  })

  it('prepare freezes the card into the contract hash and stores frozen tests outside the checkout', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-task-'))
    const result = await prepareActivation(env(stateDir, body))
    if (!result.enabled) throw new Error('not enabled')
    const contract = await loadActivation(result.filePath)
    expect(contract.task?.acceptance[0].id).toBe('AC1')
    expect(await readFile(join(frozenTestDir(stateDir, 'ticket-1'), 'tests/hephi/AC1.test.sh'), 'utf8')).toBe(`${frozen}\n`)
    const withoutTask = await prepareActivation(env(await mkdtemp(join(tmpdir(), 'hephi-task-')), 'plain issue'))
    if (!withoutTask.enabled) throw new Error('not enabled')
    expect(withoutTask.contract.contractHash).not.toBe(contract.contractHash)
  })

  it('prepare refuses a missing card when required, and a card naming an unknown check', async () => {
    await expect(prepareActivation(env(await mkdtemp(join(tmpdir(), 'hephi-task-')), 'plain issue', { HEPHI_REQUIRE_TASK: '1' }))).rejects.toThrow('hephi-task block')
    await expect(prepareActivation(env(await mkdtemp(join(tmpdir(), 'hephi-task-')), body.replace('"check": "tests"', '"check": "lint"')))).rejects.toThrow('unknown check lint')
    const noFrozen = body.slice(0, body.indexOf('```hephi-test'))
    await expect(prepareActivation(env(await mkdtemp(join(tmpdir(), 'hephi-task-')), noFrozen, { HEPHI_REQUIRE_FROZEN_TEST: '1' }))).rejects.toThrow('needs a hephi-test block')
    expect((await prepareActivation(env(await mkdtemp(join(tmpdir(), 'hephi-task-')), body, { HEPHI_REQUIRE_FROZEN_TEST: '1' }))).enabled).toBe(true)
  })

  it('keeps the goal in the Worker prompt and denies direct edits outside the item scope', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'hephi-task-'))
    await prepareActivation(env(stateDir, body))
    const guards: Array<(e: ToolExecution) => string | undefined> = []
    const prompts: Array<{ text: () => string }> = []
    const agent = {
      session: { header: { id: 'worker-ticket-1', agentPreset: 'dsh-superagent-worker', cwd: '/tmp/ticket-1' } },
      ctx: {
        on: () => () => true,
        tools: { register: () => () => true, guard: (g: (e: ToolExecution) => string | undefined) => { guards.push(g); return () => true } },
        systemPrompt: { section: (s: { text: () => string }) => { prompts.push(s); return () => true } },
      },
    } as unknown as Agent
    mountWorkerGate({} as Context, agent, { stateDir })
    const text = prompts.map(p => p.text()).join('\n')
    expect(text).toContain(`HEPHI task goal (frozen; do not reinterpret or extend): ${card.goal}`)
    expect(text).toContain('AC1: total(2, 3) is 5')
    expect(text).toContain('at most 3 files and 40 changed lines')
    expect(text).toContain('Explicitly out of scope: pricing rules; module layout')
    const deny = (name: string, args: unknown) => guards.map(g => g({ name, arguments: args, token: Symbol(), callId: 'c' } as unknown as ToolExecution)).find(Boolean)
    expect(deny('edit', { path: 'src/price.js' })).toBeUndefined()
    expect(deny('write', { file_path: '/tmp/ticket-1/tests/price.test.sh' })).toBeUndefined()
    expect(deny('edit', { path: 'src/m05.js' })).toContain('does not include src/m05.js')
    expect(deny('write', { filePath: '/tmp/ticket-1/deploy/prod.env' })).toContain('does not include deploy/prod.env')
  })
})
