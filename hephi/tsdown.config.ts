import { execFileSync } from 'node:child_process'
import { defineConfig } from 'tsdown'

export type GitRunner = (args: string[]) => string

const FULL_SHA = /^[0-9a-f]{40}$/

function realGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

/**
 * Decide which commit this build represents.
 *
 * - A Git checkout is the only source of truth: HEAD must be a full 40-hex SHA,
 *   and tracked, staged and untracked changes all make the tree dirty. A dirty
 *   tree refuses to build; HEPHI_BUILD_COMMIT never overrides a Git HEAD.
 * - Without Git (source archive), HEPHI_BUILD_COMMIT must be a full 40-hex SHA.
 *   Anything else (missing, short SHA, "unknown", blank) fails the build.
 */
export function resolveBuildCommit(
  git: GitRunner = realGit,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let head: string | undefined
  try {
    head = git(['rev-parse', 'HEAD']).trim()
  } catch {
    head = undefined
  }
  if (head !== undefined) {
    if (!FULL_SHA.test(head)) {
      throw new Error(`cannot resolve the plugin commit: git returned an invalid HEAD "${head}"`)
    }
    const dirty = git(['status', '--porcelain']).trim()
    if (dirty !== '') {
      throw new Error('refusing to build from a dirty working tree: commit or clean tracked, staged and untracked files before building')
    }
    return head
  }
  const explicit = env.HEPHI_BUILD_COMMIT?.trim() ?? ''
  if (!FULL_SHA.test(explicit)) {
    throw new Error('cannot determine the plugin commit: no git checkout, and HEPHI_BUILD_COMMIT must be a full 40-character hex SHA')
  }
  return explicit
}

export default defineConfig((_inlineConfig, _context) => ({
  entry: {
    index: 'src/index.ts',
    tools: 'src/tools.ts',
    cli: 'src/cli.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  define: { __HEPHI_COMMIT__: JSON.stringify(resolveBuildCommit()) },
}))
