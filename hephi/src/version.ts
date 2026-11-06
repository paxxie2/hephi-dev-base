/** Build-time plugin identity. The commit is injected by tsdown from the build checkout. */
declare const __HEPHI_COMMIT__: unknown

export const pluginName = 'hephi-superagent-plugin'
export const pluginVersion = '0.1.0'

/**
 * The plugin commit this code was built from. Only test/dev runs that never went
 * through the build report 'unknown'; a release build always carries a commit.
 */
export function pluginCommit(): string {
  if (typeof __HEPHI_COMMIT__ === 'string' && __HEPHI_COMMIT__ !== '') return __HEPHI_COMMIT__
  return process.env.HEPHI_BUILD_COMMIT?.trim() || 'unknown'
}
