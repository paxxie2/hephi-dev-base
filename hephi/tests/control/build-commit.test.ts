import { describe, expect, it } from 'vitest'
import config, { resolveBuildCommit, type GitRunner } from '../../tsdown.config.js'

const HEAD = 'a'.repeat(40)

function git(head: string | Error, porcelain = ''): GitRunner {
  return (args: string[]) => {
    if (args[0] === 'rev-parse') {
      if (head instanceof Error) throw head
      return `${head}\n`
    }
    if (args[0] === 'status') return porcelain
    throw new Error(`unexpected git args: ${args.join(' ')}`)
  }
}

const NO_GIT = new Error('not a git repository')
const cleanEnv: NodeJS.ProcessEnv = {}

describe('build commit resolution (R2)', () => {
  it('R2-T01: a clean Git checkout returns the full HEAD SHA', () => {
    expect(resolveBuildCommit(git(HEAD), cleanEnv)).toBe(HEAD)
  })

  it('R2-T02: tracked modifications make the build fail', () => {
    expect(() => resolveBuildCommit(git(HEAD, ' M src/index.ts\n'), cleanEnv)).toThrow(/dirty working tree/)
  })

  it('R2-T03: staged modifications make the build fail', () => {
    expect(() => resolveBuildCommit(git(HEAD, 'M  src/index.ts\n'), cleanEnv)).toThrow(/dirty working tree/)
  })

  it('R2-T04: untracked files make the build fail', () => {
    expect(() => resolveBuildCommit(git(HEAD, '?? DIRTY_PROBE.txt\n'), cleanEnv)).toThrow(/dirty working tree/)
  })

  it('R2-T05: HEPHI_BUILD_COMMIT cannot bypass a dirty Git checkout', () => {
    const env = { HEPHI_BUILD_COMMIT: 'b'.repeat(40) }
    expect(() => resolveBuildCommit(git(HEAD, '?? probe\n'), env)).toThrow(/dirty working tree/)
  })

  it('R2-T06: no Git and no explicit commit fails instead of silently using unknown', () => {
    expect(() => resolveBuildCommit(git(NO_GIT), cleanEnv)).toThrow(/HEPHI_BUILD_COMMIT must be a full 40-character hex SHA/)
  })

  it('R2-T07: no Git with an explicit full SHA is accepted', () => {
    const explicit = 'c'.repeat(40)
    expect(resolveBuildCommit(git(NO_GIT), { HEPHI_BUILD_COMMIT: explicit })).toBe(explicit)
  })

  it('R2-T08: invalid explicit commits are rejected', () => {
    for (const value of ['abc123', 'unknown', '', '   ', 'C'.repeat(40), 'g'.repeat(40), `${'d'.repeat(40)}-dirty`]) {
      expect(() => resolveBuildCommit(git(NO_GIT), { HEPHI_BUILD_COMMIT: value })).toThrow(/HEPHI_BUILD_COMMIT/)
    }
  })

  it('exports the config as a lazy function so importing it never runs git', () => {
    expect(typeof config).toBe('function')
  })
})
