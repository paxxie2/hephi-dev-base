import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { hephiToolDefinitions } from '../../src/tools.js'
import { activationPath, contractHash, prepareActivation } from '../../src/control/activation.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function execution(ticket: string, preset = 'dsh-superagent-worker'): ToolRunContext {
  return { agent: { session: { header: { id: `worker-${ticket}`, agentPreset: preset, cwd: '/not-the-host-cwd' } } } } as unknown as ToolRunContext
}

async function setup() {
  const stateDir = await mkdtemp(join(tmpdir(), 'hephi-worker-tools-'))
  directories.push(stateDir)
  for (const ticket of ['one', 'two']) await prepareActivation({
    HEPHI_ENABLED: '1', HEPHI_STATE_DIR: stateDir, DSH_SUPERAGENT_TICKET: ticket,
    DSH_SUPERAGENT_DIR: `/work/${ticket}`, DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo',
    DSH_SUPERAGENT_GITHUB_NUMBER: ticket === 'one' ? '1' : '2', HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["dubbo-*/**"]', HEPHI_TEST_COMMAND: 'forward', HEPHI_REVERSE_TEST_COMMAND: 'reverse',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({version:1,checks:[{id:'fixture-build',kind:'build',purpose:'fixture command',command:'true',args:[],cwd:'.',required:true,timeoutMs:5000,}]}),
  })
  const tools = hephiToolDefinitions(stateDir)
  return { stateDir, contract: tools.find(tool => tool.name === 'hephi_get_contract')!, kb: tools.find(tool => tool.name === 'hephi_kb_search')! }
}

describe('Super Agent tool context', () => {
  it('exposes only contract and KB tools, not the legacy delivery/verification chain', () => {
    expect(hephiToolDefinitions().map(tool => tool.name)).toEqual(['hephi_get_contract', 'hephi_kb_search'])
  })
  it('binds each contract to the calling Worker, without host process Ticket environment', async () => {
    const { contract } = await setup()
    expect(await contract.execute({}, execution('one'))).toMatchObject({ ticketId: 'one', issueNumber: 1, workspace: '/work/one' })
    expect(await contract.execute({}, execution('two'))).toMatchObject({ ticketId: 'two', issueNumber: 2, workspace: '/work/two' })
  })

  it('rejects an ordinary Session and a missing Worker contract in both tools', async () => {
    const { contract, kb } = await setup()
    await expect(contract.execute({}, execution('one', 'standard'))).rejects.toThrow(/Worker Session/)
    await expect(contract.execute({}, execution('missing'))).rejects.toThrow(/ENOENT/)
    await expect(kb.execute({ query: 'NetUtils' }, execution('missing'))).rejects.toThrow(/ENOENT/)
  })

  it('rejects a valid contract copied from another Ticket', async () => {
    const { stateDir, contract } = await setup()
    const file = activationPath(stateDir, 'one')
    const { contractHash: _hash, ...payload } = JSON.parse(await readFile(file, 'utf8'))
    payload.ticketId = 'two'
    await writeFile(file, JSON.stringify({ ...payload, contractHash: contractHash(payload) }))
    await expect(contract.execute({}, execution('one'))).rejects.toThrow(/different Ticket/)
  })
})
