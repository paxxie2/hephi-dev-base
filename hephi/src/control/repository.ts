import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { matchesGlob } from 'node:path'

const exec = promisify(execFile)

export type PullRequestInfo = {
  state?: string
  baseRef?: string
  headSha?: string
}

export function allowedPath(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchesGlob(file, pattern))
}

export async function clean(workspace: string): Promise<boolean> {
  const result = await exec('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace, maxBuffer: 2 * 1024 * 1024 })
  return result.stdout.trim() === ''
}

export function normalizeRepository(value: string): string {
  const text = value.trim().replace(/\.git$/, '')
  const ssh = text.match(/^git@[^:]+:(.+)$/)?.[1]
  const https = text.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i)?.[1]
  return (ssh ?? https ?? text).replace(/^\/+/, '').replace(/\.git$/, '')
}

export async function remoteRepository(workspace: string): Promise<string> {
  const result = await exec('git', ['remote', 'get-url', 'origin'], { cwd: workspace })
  const repository = normalizeRepository(result.stdout)
  if (!repository.includes('/')) throw new Error('worker workspace has no usable origin remote')
  return repository
}

export async function hasCommit(workspace: string, commit: string): Promise<boolean> {
  try {
    await exec('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: workspace })
    return true
  } catch {
    return false
  }
}

export async function defaultPullRequest(repository: string, number: number, cli = 'gh'): Promise<PullRequestInfo> {
  const response = await exec(cli, ['api', `repos/${repository}/pulls/${number}`], { maxBuffer: 4 * 1024 * 1024 })
  const value = JSON.parse(response.stdout) as { state?: string; base?: { ref?: string }; head?: { sha?: string } }
  return { state: value.state, baseRef: value.base?.ref, headSha: value.head?.sha }
}
