import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { gitFingerprint, sha256 } from '../../src/verification/fingerprint.js'

const exec = promisify(execFile)
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), 'hephi-fingerprint-'))
  directories.push(cwd)
  const git = (...args: string[]) => exec('git', args, { cwd })
  await git('init')
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base')
  const { stdout } = await git('rev-parse', 'HEAD')
  return { cwd, git, base: stdout.trim() }
}

it('hashes the complete binary patch above 1 MiB with unchanged SHA-256 semantics', async () => {
  const { cwd, git, base } = await repository()
  const bytes = randomBytes(2 * 1024 * 1024)
  bytes[0] = 0
  await writeFile(join(cwd, 'evidence.png'), bytes)
  await git('add', 'evidence.png')
  const { stdout: patch } = await exec('git', ['diff', '--binary', base, '--'], { cwd, maxBuffer: 8 * 1024 * 1024 })
  expect(Buffer.byteLength(patch)).toBeGreaterThan(1024 * 1024)
  const result = await gitFingerprint(cwd, base)
  expect(result.patchHash).toBe(sha256(patch))
  expect(result.changedFiles).toEqual(['evidence.png'])
  expect(result.headCommit).toBe(base)
  bytes[bytes.length - 1] ^= 1
  await writeFile(join(cwd, 'evidence.png'), bytes)
  expect((await gitFingerprint(cwd, base)).patchHash).not.toBe(result.patchHash)
})

it('rejects a failed git diff instead of hashing its partial output', async () => {
  const { cwd } = await repository()
  await expect(gitFingerprint(cwd, 'not-a-real-ref')).rejects.toThrow('git diff failed')
})
