/** HEPHI Super Agent plugin bundle entry point. */
import type { Context } from '@deepseek-ai/cordis'
import { defaultStateDir } from './control/activation.js'
import { createEvidenceVerifier } from './control/evidence-verifier.js'
import { installWorkerMount } from './control/worker-mount.js'

export * from './control/index.js'

export const pluginName = 'hephi-superagent-plugin'
export const pluginVersion = '0.1.0'
export const inject = ['agents', 'tools', 'systemPrompt']

/** Cordis bundle entry. The control plane only observes existing Worker Agents. */
export function apply(ctx: Context, config: { stateDir?: string } = {}): void {
  const stateDir = defaultStateDir(config.stateDir)
  const dispose = installWorkerMount(ctx, { stateDir, verify: createEvidenceVerifier({ stateDir }) })
  ctx.effect(() => dispose, `${pluginName}: worker ready gate`)
}

/**
 * The runtime integration is registered by Cordis through cordis.patch.yml.
 * Keeping this module side-effect free makes the domain code testable outside DSH.
 */
export function describePlugin(): { name: string; version: string } {
  return { name: pluginName, version: pluginVersion }
}
