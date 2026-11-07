/** HEPHI Super Agent plugin bundle entry point. */
import type { Context } from '@deepseek-ai/cordis'
import { defaultStateDir } from './control/activation.js'
import type { NativeJobs } from './control/check-runner.js'
import { createEvidenceVerifier, type SessionSnapshot } from './control/evidence-verifier.js'
import { installWorkerMount } from './control/worker-mount.js'
import { pluginCommit, pluginName, pluginVersion } from './version.js'

export * from './control/index.js'

export { pluginCommit, pluginName, pluginVersion } from './version.js'
export const inject = ['agents', 'tools', 'systemPrompt']

/**
 * Cordis bundle entry. The control plane only observes existing Worker Agents.
 * Session binding is decided by the contract (A1-K5: `evidence.requireSessionBinding`,
 * frozen at prepare) with this host configuration able to tighten it only. Host config
 * still defaults to off until the host's event structure for inner check calls is confirmed.
 */
export function apply(ctx: Context, config: { stateDir?: string; requireSessionBinding?: boolean; allowOperatorResolutions?: boolean } = {}): void {
  const stateDir = defaultStateDir(config.stateDir)
  // Host-side requirement. It is combined with the contract value inside the verifier
  // (effective = contract OR host); it can never relax a contract that requires binding.
  const hostRequireSessionBinding = config.requireSessionBinding ?? process.env.HEPHI_REQUIRE_SESSION_BINDING === '1'
  // A3 host switch. The environment variable is only a temporary bootstrap; the real trust
  // boundary (operator-only configuration, not inherited by Worker shells) is pending G1.
  const allowOperatorResolutions = config.allowOperatorResolutions ?? process.env.HEPHI_ALLOW_OPERATOR_RESOLUTIONS === '1'
  const readSession = async (sessionId: string): Promise<SessionSnapshot> => {
    const query = ctx.get('sessionQuery') as { readSession(id: string): Promise<SessionSnapshot> } | undefined
    if (!query) throw new Error('host sessionQuery service is unavailable; evidence cannot be bound to native executions')
    return query.readSession(sessionId)
  }
  // A1-BIND/A1-OUT: the host Job registry is optional. Without it a background check's
  // terminal state and output cannot be verified, so ready denies that evidence instead of
  // trusting the record; foreground checks are unaffected.
  let jobs: NativeJobs | undefined
  try { jobs = ctx.get('jobs') as NativeJobs | undefined } catch { jobs = undefined }
  const verify = createEvidenceVerifier({ stateDir, readSession, requireSessionBinding: hostRequireSessionBinding, allowOperatorResolutions, jobs })
  const dispose = installWorkerMount(ctx, { stateDir, verify })
  ctx.effect(() => dispose, `${pluginName}: worker ready gate`)
}

/**
 * The runtime integration is registered by Cordis through cordis.patch.yml.
 * Keeping this module side-effect free makes the domain code testable outside DSH.
 */
export function describePlugin(): { name: string; version: string; commit: string } {
  return { name: pluginName, version: pluginVersion, commit: pluginCommit() }
}
