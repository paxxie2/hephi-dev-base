#!/usr/bin/env node
// P13 预算附录格式预检：PREREG 必须写明金额与币种、单次/总上限、停止规则和负责人。
// 本脚本只做文档预检，不替代实测成本复算与负责人批准。
// 用法：node eval/check-budget.mjs [--prereg eval/PREREG.md]
import { existsSync, readFileSync } from 'node:fs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const file = arg('prereg', 'eval/PREREG.md')
if (!existsSync(file)) {
  console.error(`预算文件不存在：${file}（需要负责人批准的真实预算后才可执行）`)
  process.exit(2)
}

const text = readFileSync(file, 'utf8')
const checks = [
  { id: 'amount', ok: /(?:¥|￥|CNY|RMB|USD|\u0024)\s*\d[\d,.]*|\d[\d,.]*\s*(?:元|美元|CNY|USD)/.test(text), msg: '缺少预算金额' },
  { id: 'currency', ok: /(?:币种|currency)\s*[:：]/i.test(text), msg: '缺少币种说明' },
  { id: 'perRunCap', ok: /(?:单次|每次|per[-\s]?run)[^\n]{0,30}(?:上限|cap|limit)/i.test(text), msg: '缺少单次运行上限' },
  { id: 'totalCap', ok: /(?:总预算|总额|total)[^\n]{0,30}(?:上限|cap|limit)/i.test(text), msg: '缺少总预算上限' },
  { id: 'stopRule', ok: /(?:停止规则|stop rule)/i.test(text), msg: '缺少停止规则' },
  { id: 'owner', ok: /(?:负责人|批准人|approver|owner)/i.test(text), msg: '缺少具名负责人/批准人' },
]
const missing = checks.filter((check) => !check.ok).map((check) => check.msg)
const result = { file, checks: Object.fromEntries(checks.map((check) => [check.id, check.ok])), missing, ok: missing.length === 0 }
console.log(JSON.stringify(result, null, 2))
process.exit(missing.length === 0 ? 0 : 1)
