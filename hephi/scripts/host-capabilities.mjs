#!/usr/bin/env node
// G1 宿主能力调查：只读回读宿主编排器状态，并原样保存。
// 只报告能从机器状态推导的结论；G1 清单中的其余能力必须人工探测并单独记录，不由本脚本判定。
// 用法：node hephi/scripts/host-capabilities.mjs --host http://127.0.0.1:3083 [--out <file.json>]
import { writeFileSync } from 'node:fs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const host = (arg('host', 'http://127.0.0.1:3083')).replace(/\/$/, '')
const out = arg('out', null)
const url = `${host}/orchestrator/api/state`

let state
try {
  const res = await fetch(url, { headers: { 'x-orchestrator-request': '1' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  state = await res.json()
} catch (error) {
  console.error(`宿主状态不可读：${url} (${error.message})`)
  process.exit(1)
}

const report = {
  probe: 'G1 host-capabilities (state readback only)',
  host,
  at: new Date().toISOString(),
  derivedFromStateOnly: true,
  state,
  capabilities: [
    { item: 'state_readable', value: '具备' },
    { item: 'paused_flag', value: typeof state.paused === 'boolean' ? '具备' : '不具备' },
    { item: 'load_counters', value: state.load ? '具备' : '不具备' },
    { item: 'plugin_version_readback', value: '不具备（仓库内 describePlugin 无调用入口，需人工确认宿主 API）' },
    { item: 'other_items_1_2_3a_3_to_10', value: '未验证（需按 ROADMAP-95-PREREQUISITES.md G1 清单人工探测）' },
  ],
  manualChecks: '第 1、2、3a、3–10 项及新增的工具结果告警、实载版本回读、维护排空必须人工执行并记录原始输出。',
}

if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  host,
  stateReadable: true,
  paused: state.paused ?? null,
  running: state.load?.running ?? null,
  queued: state.load?.queued ?? null,
  health: Object.fromEntries(Object.entries(state.health ?? {}).map(([k, v]) => [k, v?.state ?? null])),
  out: out ?? null,
}, null, 2))
