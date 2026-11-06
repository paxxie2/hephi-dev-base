import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activationPath, contractHash, prepareActivation } from '../../src/control/activation.js'
import { describePlugin } from '../../src/index.js'
import { pluginCommit, pluginVersion } from '../../src/version.js'

async function stateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hephi-plugin-version-'))
}

function enabledEnv(dir: string): NodeJS.ProcessEnv {
  return {
    HEPHI_ENABLED: '1',
    HEPHI_STATE_DIR: dir,
    HEPHI_BASE_COMMIT: 'a'.repeat(40),
    HEPHI_ALLOWED_PATHS: '["src/**"]',
    DSH_SUPERAGENT_TICKET: 'ticket-1',
    DSH_SUPERAGENT_DIR: '/tmp/ticket-1',
    DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo',
    DSH_SUPERAGENT_GITHUB_NUMBER: '42',
    HEPHI_VERIFICATION_CHECKS: JSON.stringify({ version: 1, checks: [{ id: 'fixture-build', kind: 'build', purpose: 'fixture command', command: 'true', args: [], cwd: '.', required: true, timeoutMs: 5000 }] }),
  }
}

describe('plugin version traceability', () => {
  it('describes the plugin with the build commit', () => {
    expect(describePlugin()).toEqual({ name: 'hephi-superagent-plugin', version: pluginVersion, commit: pluginCommit() })
  })

  it('freezes plugin metadata into the contract and its hash', async () => {
    const dir = await stateDir()
    const prepared = await prepareActivation(enabledEnv(dir))
    if (!prepared.enabled) throw new Error('activation was not enabled')
    expect(prepared.contract.plugin).toEqual({ version: pluginVersion, commit: pluginCommit() })
    const raw = JSON.parse(await readFile(activationPath(dir, 'ticket-1'), 'utf8')) as Record<string, unknown>
    expect(raw.plugin).toEqual({ version: pluginVersion, commit: pluginCommit() })
    const { contractHash: hash, ...base } = raw as Record<string, unknown> & { contractHash: string }
    expect(hash).toBe(contractHash(base as never))
    expect(contractHash({ ...base, plugin: { version: pluginVersion, commit: 'other' } } as never)).not.toBe(hash)
  })
})
