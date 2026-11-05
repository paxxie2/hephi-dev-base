import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitRoot, resolveWorkspace } from '../../src/control/workspace.js'

const run = promisify(execFile)

async function initRepository(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await run('git', ['init', '-b', 'main', directory])
}

describe('workspace resolution', () => {
  it('prefers the Worker Session checkout when activation is only a container', async () => {
    const container = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    const worker = join(container, 'worker')
    await initRepository(worker)
    await expect(resolveWorkspace(container, worker)).resolves.toBe(await realpath(worker))
  })

  it('resolves exactly one nested checkout', async () => {
    const container = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    const worker = join(container, 'worker')
    await initRepository(worker)
    await expect(resolveWorkspace(container)).resolves.toBe(await realpath(worker))
  })

  it('rejects multiple nested checkouts', async () => {
    const container = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    await initRepository(join(container, 'worker-a'))
    await initRepository(join(container, 'worker-b'))
    await expect(resolveWorkspace(container)).rejects.toThrow('exactly one nested worktree')
  })

  it('returns undefined for a non Git directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    await expect(gitRoot(directory)).resolves.toBeUndefined()
  })

  it('accepts only the exact contract Git root and its session subdirectories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    await initRepository(directory)
    const subdirectory = join(directory, 'src')
    await mkdir(subdirectory)
    await expect(resolveWorkspace(directory, subdirectory)).resolves.toBe(await realpath(directory))
  })

  it('rejects an external Session clone even when the contract is a Git root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    const contract = join(directory, 'repo')
    const external = join(directory, 'repo-other')
    await initRepository(contract)
    await initRepository(external)
    await expect(resolveWorkspace(contract, external)).rejects.toThrow()
  })

  it('does not promote an enclosing repository to the contract checkout', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    await initRepository(parent)
    const container = join(parent, 'ticket')
    await mkdir(container)
    await expect(resolveWorkspace(container, container)).rejects.toThrow()
  })

  it('rejects a symlink from the contract container to an external checkout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    const container = join(directory, 'ticket')
    const external = join(directory, 'external')
    await mkdir(container)
    await initRepository(external)
    const link = join(container, 'checkout')
    await symlink(external, link)
    await expect(resolveWorkspace(container, link)).rejects.toThrow()
  })

  it('does not use Session cwd to resolve an ambiguous container', async () => {
    const container = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    const worker = join(container, 'worker-a')
    await initRepository(worker)
    await initRepository(join(container, 'worker-b'))
    await expect(resolveWorkspace(container, worker)).rejects.toThrow()
  })

  it('rejects an unrelated non-Git Session directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hephi-workspace-'))
    const checkout = join(directory, 'checkout')
    const other = join(directory, 'other')
    await initRepository(checkout)
    await mkdir(other)
    await expect(resolveWorkspace(checkout, other)).rejects.toThrow()
  })
})
