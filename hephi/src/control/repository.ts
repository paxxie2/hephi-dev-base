import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { matchesGlob } from 'node:path'

const exec = promisify(execFile)

export type PullRequestReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'

/** C3: one PR review as returned by the host (`gh api .../pulls/<n>/reviews`). */
export type PullRequestReview = {
  author: string
  state: PullRequestReviewState
  /** Commit the review applies to; only reviews for the current PR HEAD can approve. */
  commitId?: string
}

export type PullRequestInfo = {
  state?: string
  baseRef?: string
  headSha?: string
  /** C3: reviews in host order (GitHub returns them chronologically; the latest per author wins). */
  reviews?: PullRequestReview[]
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

const REVIEW_STATES: readonly PullRequestReviewState[] = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']

function normalizeReview(value: unknown): PullRequestReview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const review = value as { user?: { login?: unknown }; state?: unknown; commit_id?: unknown }
  if (typeof review.user?.login !== 'string' || review.user.login === '') return undefined
  // Unknown host states are treated as neutral COMMENTS so they can never approve/block.
  const state = REVIEW_STATES.includes(review.state as PullRequestReviewState) ? review.state as PullRequestReviewState : 'COMMENTED'
  return { author: review.user.login, state, ...(typeof review.commit_id === 'string' && review.commit_id !== '' ? { commitId: review.commit_id } : {}) }
}

/**
 * C3: read all PR reviews with the default `gh` CLI. Used only when the contract has
 * approvers; the plain `defaultPullRequest` stays review-free so existing PR checks keep
 * their old behavior and only one extra API call is made when approvals are configured.
 * FI-FIXME(C3): the real host/gh pagination shape is not verified (tests inject fixtures).
 */
export async function defaultPullRequestReviews(repository: string, number: number, cli = 'gh'): Promise<PullRequestReview[]> {
  const response = await exec(cli, ['api', `repos/${repository}/pulls/${number}/reviews`, '--paginate', '--slurp'], { maxBuffer: 16 * 1024 * 1024 })
  const pages = JSON.parse(response.stdout) as unknown
  const rows = Array.isArray(pages) ? (pages.some(Array.isArray) ? pages.flat() : pages) : []
  return rows.map(normalizeReview).filter((review): review is PullRequestReview => review !== undefined)
}
