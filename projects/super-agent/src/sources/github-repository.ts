/** Repository scoping for the existing GitHub source; no new workers or queues. */
import { key, type Trigger, type Ticket } from '../core/index.ts'
import type { SourceContext } from './host.ts'

export const repositoryFromUrl = (url?: string): string | undefined =>
  /^https:\/\/(?:github\.com|api\.github\.com\/repos)\/([^/]+\/[^/#?]+)/i.exec(url ?? '')?.[1]
export const triggerRepository = (trigger: Trigger | undefined, fallback: string): string =>
  typeof trigger?.meta.repository === 'string' ? trigger.meta.repository : repositoryFromUrl(trigger?.url) ?? fallback
export const repositoryKey = (ctx: Pick<SourceContext, 'deployment'>): string =>
  ctx.deployment.repository.toLowerCase() === (ctx.deployment.repositories?.[0] ?? ctx.deployment.repository).toLowerCase() ? '' : ctx.deployment.repository.toLowerCase()
export const githubId = (ctx: Pick<SourceContext, 'deployment'>, number: number | string): string =>
  `${repositoryKey(ctx) ? `${repositoryKey(ctx)}:` : ''}${number}`
export const githubThread = (ctx: Pick<SourceContext, 'deployment'>, number: number | string): string => `github:${githubId(ctx, number)}`
export const threadNumber = (id: string): number => Number(id.split(':').at(-1))
export const belongsToRepository = (id: string, repository: string): boolean => repository ? id.startsWith(`${repository}:`) : !id.includes('/')

export function githubContext(ctx: SourceContext, repository: string): SourceContext {
  const commands = repository.toLowerCase() === ctx.deployment.repository.toLowerCase() ? ctx.commands : ctx.commands.forRepository(repository)
  const deployment = { ...ctx.deployment, repository: commands.repository }
  const namespace = repositoryKey({ deployment })
  const belongs = (ticket: Ticket): boolean => {
    const origin = ctx.triggers.get(ticket.origin.triggerId)
    return origin?.source !== 'github' || triggerRepository(origin, ctx.deployment.repositories?.[0] ?? ctx.deployment.repository).toLowerCase() === repository.toLowerCase()
  }
  return {
    ...ctx, deployment, commands,
    state: namespace ? {
      get: name => ctx.state.get(`${namespace}:${name}`),
      set: (name, value) => ctx.state.set(`${namespace}:${name}`, value),
      keys: family => ctx.state.keys(Object.assign(() => '' as ReturnType<typeof family>, { prefix: `${namespace}:${family.prefix}` })).map(name => name.slice(namespace.length + 1)),
    } : ctx.state,
    threads: { ...ctx.threads, subscribed: source => ctx.threads.subscribed(source).filter(thread => belongsToRepository(thread.ref.id, namespace)) },
    tickets: { ...ctx.tickets, open: () => ctx.tickets.open().filter(belongs), get: id => { const ticket = ctx.tickets.get(id); return ticket && belongs(ticket) ? ticket : undefined } },
    receive: trigger => {
      const threads = trigger.threads.map(ref => ref.source === 'github' ? { ...ref, id: githubId({ deployment }, ref.id) } : ref)
      const channel = trigger.channel && { ...trigger.channel,
        ...(trigger.channel.thread ? { thread: `github:${githubId({ deployment }, trigger.channel.thread.slice(7))}` } : {}),
        address: { ...trigger.channel.address, repository } }
      return ctx.receive({ ...trigger, ...(namespace ? { id: key(namespace, trigger.id) } : {}), threads,
        ...(channel ? { channel } : {}), meta: { ...trigger.meta, repository } })
    },
  }
}
