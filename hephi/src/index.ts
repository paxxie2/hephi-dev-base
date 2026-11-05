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
export function apply(ctx: Context, config: { stateDir?: string; requireSessionBinding?: boolean } = {}): void {
  const stateDir = defaultStateDir(config.stateDir)
  type SessionQuery = { readSession(id: string): Promise<{ events: Array<{ type: string; data: unknown }> }> }
  const sessionEvents = async (sessionId: string) => {
    const query = ctx.get('sessionQuery') as SessionQuery | undefined
    if (!query) throw new Error('host sessionQuery service is unavailable; evidence cannot be bound to native executions')
    return (await query.readSession(sessionId)).events
  }
  const requireSessionBinding = config.requireSessionBinding ?? process.env.HEPHI_REQUIRE_SESSION_BINDING !== '0'
  const verify = createEvidenceVerifier({ stateDir, sessionEvents: requireSessionBinding ? sessionEvents : undefined })
  const dispose = installWorkerMount(ctx, { stateDir, verify })
  ctx.effect(() => dispose, `${pluginName}: worker ready gate`)
}

/**
 * The runtime integration is registered by Cordis through cordis.patch.yml.
 * Keeping this module side-effect free makes the domain code testable outside DSH.
 */
export function describePlugin(): { name: string; version: string } {
  return { name: pluginName, version: pluginVersion }
}
