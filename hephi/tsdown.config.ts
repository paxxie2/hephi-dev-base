import { execFileSync } from 'node:child_process'
import { defineConfig } from 'tsdown'

/**
 * Inject the commit this build was made from. A dirty checkout is recorded
 * explicitly (not hidden); building outside git requires HEPHI_BUILD_COMMIT.
 */
function buildCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== ''
    return dirty ? `${sha}-dirty` : sha
  } catch {
    const explicit = process.env.HEPHI_BUILD_COMMIT?.trim()
    if (!explicit) throw new Error('cannot determine the plugin commit: no git checkout and HEPHI_BUILD_COMMIT is unset')
    return explicit
  }
}

export default defineConfig({
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
  define: { __HEPHI_COMMIT__: JSON.stringify(buildCommit()) },
})
