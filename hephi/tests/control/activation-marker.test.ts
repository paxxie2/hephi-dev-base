import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply as applyIndex } from '../../src/index.js'
import { apply as applyTools } from '../../src/tools.js'
import { ACTIVATION_MARKER_PREFIX, activationMarker, pluginCommit, pluginName } from '../../src/version.js'

// F5：部署脚本真正执行的 marker 解析正则（从 deploy-hephi.sh 源码取出，不复制第二份口径）。
function deployActivationMarkerPattern(): RegExp {
  const source = readFileSync(new URL('../../../scripts/host/deploy-hephi.sh', import.meta.url), 'utf8')
  const found = /const match = \/(.+)\/\.exec\(raw\.trim\(\)\)/.exec(source)
  if (!found) throw new Error('cannot find the activation marker parser in deploy-hephi.sh')
  return new RegExp(found[1])
}

async function stateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hephi-activation-marker-'))
}

// 聚焦测试：只验证两个 bundle entry 在注册完成后各写一行可解析的激活标识。
// 部署脚本对真实宿主日志的门禁由假宿主套件与真实验证分别覆盖，这里不是端到端证据。
describe('plugin activation markers (issue #26)', () => {
  it('formats one stable single-line marker per bundle entry', () => {
    const index = activationMarker('index')
    const tools = activationMarker('tools')
    for (const marker of [index, tools]) {
      expect(marker.startsWith(`${ACTIVATION_MARKER_PREFIX} `)).toBe(true)
      expect(marker).toContain(`plugin=${pluginName} `)
      expect(marker).toContain(`commit=${pluginCommit()} `)
      expect(marker).toContain(`pid=${process.pid}`)
      expect(marker).not.toContain('\n')
    }
    expect(index).toBe(`${ACTIVATION_MARKER_PREFIX} entry=index plugin=${pluginName} commit=${pluginCommit()} pid=${process.pid}`)
    expect(tools).toBe(`${ACTIVATION_MARKER_PREFIX} entry=tools plugin=${pluginName} commit=${pluginCommit()} pid=${process.pid}`)
  })

  it('generates markers the deploy script parser accepts (F5 cross-module contract)', () => {
    const pattern = deployActivationMarkerPattern()
    vi.stubEnv('HEPHI_BUILD_COMMIT', 'b'.repeat(40))
    try {
      for (const entry of ['index', 'tools'] as const) {
        const marker = activationMarker(entry)
        const fields = pattern.exec(marker)
        expect(fields, marker).not.toBeNull()
        expect(fields![1]).toBe(entry)
        expect(fields![2]).toBe(pluginName)
        expect(fields![3]).toBe('b'.repeat(40))
        expect(fields![4]).toBe(String(process.pid))
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rejects format drift that the deploy parser would not accept (negative fixture)', () => {
    const pattern = deployActivationMarkerPattern()
    vi.stubEnv('HEPHI_BUILD_COMMIT', 'b'.repeat(40))
    let valid: string
    try {
      valid = activationMarker('index')
    } finally {
      vi.unstubAllEnvs()
    }
    expect(pattern.test(valid)).toBe(true)
    const drifted = [
      valid.replace('entry=index', 'entry='), // 缺 entry
      valid.replace(/commit=[^ ]+/, 'commit=unknown'), // commit 非 40hex
      valid.replace(/pid=[0-9]+/, 'pid=x'), // pid 非数字
      valid.replace('plugin=', 'plugin=bad name '), // 插件名含空格
      valid.replace(ACTIVATION_MARKER_PREFIX, '[hephi-activation-x]'), // 前缀漂移
      `${valid} extra=1`, // 多余字段
    ]
    for (const marker of drifted) expect(pattern.test(marker), marker).toBe(false)
  })

  it('index apply logs its marker only after registration', async () => {
    const dir = await stateDir()
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)) })
    try {
      const ctx = {
        get: () => undefined,
        on: () => () => {},
        effect: () => {},
        agents: { list: () => [] },
      } as unknown as Context
      applyIndex(ctx, { stateDir: dir })
    } finally {
      spy.mockRestore()
    }
    expect(logs).toEqual([activationMarker('index')])
  })

  it('tools apply logs its marker only after registration', async () => {
    const dir = await stateDir()
    const logs: string[] = []
    const registered: unknown[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)) })
    try {
      const ctx = {
        tools: { register: (definition: unknown) => { registered.push(definition); return () => {} } },
        effect: () => {},
      } as unknown as Context
      applyTools(ctx, { stateDir: dir })
    } finally {
      spy.mockRestore()
    }
    // 0.1.0 注册 hephi_get_contract 与 hephi_kb_search 两个工具，然后写一条激活标识。
    expect(registered).toHaveLength(2)
    expect(logs).toEqual([activationMarker('tools')])
  })
})
