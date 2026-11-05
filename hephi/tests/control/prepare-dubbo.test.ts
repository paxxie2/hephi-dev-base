import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function prepare(extra: NodeJS.ProcessEnv) {
  const dir = await mkdtemp(join(tmpdir(), 'hephi-prepare-test-'))
  directories.push(dir)
  const cli = join(dir, 'gh')
  const calls = join(dir, 'calls')
  await writeFile(cli, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROBE_CALLS"\n', { mode: 0o755 })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_SUPERAGENT_') && !key.startsWith('HEPHI_')))
  const result = spawnSync('sh', [resolve('scripts/prepare-dubbo.sh')], {
    cwd: dir, encoding: 'utf8',
    env: { ...env, DSH_SUPERAGENT_DIR: join(dir, 'worker'), DSH_SUPERAGENT_NAME: 'test', HEPHI_STATE_DIR: join(dir, 'state'), HEPHI_GH_CLI: cli, PROBE_CALLS: calls, ...extra },
  })
  return { result, dir, calls }
}

describe('optional Dubbo prepare', () => {
  it.each([{}, { DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo', DSH_SUPERAGENT_GITHUB_NUMBER: '' }])('leaves non-GitHub tasks untouched: %j', async env => {
    const { result, dir, calls } = await prepare(env)
    expect(result.status).toBe(0)
    for (const file of [calls, join(dir, 'worker'), join(dir, 'state')]) await expect(access(file)).rejects.toThrow()
  })

  it('fails on a GitHub issue without its repository', async () => {
    const { result, calls } = await prepare({ DSH_SUPERAGENT_GITHUB_NUMBER: '53' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('DSH_SUPERAGENT_GITHUB_REPOSITORY')
    await expect(access(calls)).rejects.toThrow()
  })

  it('leaves unlabelled GitHub issues without a workspace or activation', async () => {
    const { result, dir, calls } = await prepare({ DSH_SUPERAGENT_GITHUB_REPOSITORY: 'paxxie2/dubbo', DSH_SUPERAGENT_GITHUB_NUMBER: '53' })
    expect(result.status).toBe(0)
    expect((await readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(1)
    for (const file of [join(dir, 'worker'), join(dir, 'state')]) await expect(access(file)).rejects.toThrow()
  })
})
