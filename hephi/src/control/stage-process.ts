import { spawn } from 'node:child_process'
import { open } from 'node:fs/promises'
import { writeSync } from 'node:fs'

export function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    return true
  }
}

/** A foreground check owns a process group. Never unlock while descendants may live. */
export async function runStageCheck(options: {
  command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; log: string;
  signal?: AbortSignal; timeoutMs: number; onPid: (pid: number) => void; onStopped: () => void
}): Promise<{ exitCode: number | null; ended: boolean; interrupted: boolean }> {
  let log
  try { options.signal?.throwIfAborted(); log = await open(options.log, 'wx') }
  catch (error) { options.onStopped(); throw error } // No process was started.
  try {
    return await new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(options.command, options.args, {
          cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', log.fd, log.fd],
        })
      } catch (error) {
        try { options.onStopped() } catch (persistError) { reject(persistError); return }
        reject(error); return
      }
      let interrupted = false
      let persistenceError: unknown
      const kill = () => {
        interrupted = true
        if (child.pid) try { process.kill(-child.pid, 'SIGKILL') } catch { /* verified below */ }
      }
      child.once('spawn', () => {
        try { options.onPid(child.pid!) } catch (error) { persistenceError = error; kill() }
      })
      const timer = setTimeout(kill, options.timeoutMs)
      options.signal?.addEventListener('abort', kill, { once: true })
      if (options.signal?.aborted) kill()
      child.once('error', error => {
        try { writeSync(log.fd, `Process error: ${error.message}\n`) }
        catch (logError) { persistenceError ??= logError; kill() }
      })
      child.once('close', async code => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', kill)
        try {
          // A shell may exit while a descendant still writes. Terminate that group.
          if (child.pid && groupAlive(child.pid)) kill()
          for (let n = 0; child.pid && groupAlive(child.pid) && n < 20; n++) {
            await new Promise(r => setTimeout(r, 50))
          }
          const ended = !child.pid || !groupAlive(child.pid)
          if (ended) options.onStopped()
          if (persistenceError) reject(persistenceError)
          else resolve({ exitCode: code, ended, interrupted })
        } catch (error) { reject(error) }
      })
    })
  } finally { await log.close() }
}
