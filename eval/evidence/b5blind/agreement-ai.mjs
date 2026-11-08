#!/usr/bin/env node
// B5 盲评：AI agent 标注 vs AI 代复核标注的一致性（描述性，非人类、非独立）。
// 输入：eval/evidence/b5blind/agent-labels.json、owner-labels.delegate.json
// 输出：eval/evidence/b5blind/agreement-ai.json
// 说明：这不是 human–agent agreement，也不是双人 kappa；两位标注者均为 AI，且
// delegate 标注者自述接触过 agent 标签摘要，不构成独立盲评。
import { readFileSync, writeFileSync } from 'node:fs'

const a = JSON.parse(readFileSync('eval/evidence/b5blind/agent-labels.json', 'utf8'))
const d = JSON.parse(readFileSync('eval/evidence/b5blind/owner-labels.delegate.json', 'utf8'))
const cases = Object.keys(a.cases).sort()

const fields = {
  objectiveChanged: (c) => c.objectiveChanged,
  requiredFunctionImplemented: (c) => c.requiredFunctionImplemented,
  'implementationDefect.verdict': (c) => c.implementationDefect?.verdict,
  'outOfScopeChanges.has': (c) => c.outOfScopeChanges?.has,
  'unrelatedChanges.has': (c) => c.unrelatedChanges?.has,
  'testWeakening.has': (c) => c.testWeakening?.has,
  'validationEnvironment.status': (c) => c.validationEnvironment?.status,
  delivery: (c) => c.delivery,
}

function kappa(pairs) {
  const labels = [...new Set(pairs.flat())]
  const n = pairs.length
  if (labels.length < 2) return { kappa: null, undefinedReason: 'single-category (no variance)' }
  let agree = 0
  const row = Object.fromEntries(labels.map((l) => [l, 0]))
  const col = Object.fromEntries(labels.map((l) => [l, 0]))
  for (const [x, y] of pairs) {
    if (x === y) agree++
    row[x]++; col[y]++
  }
  const po = agree / n
  let pe = 0
  for (const l of labels) pe += (row[l] / n) * (col[l] / n)
  if (pe === 1) return { kappa: null, undefinedReason: 'pe=1 (no variance)' }
  return { kappa: Number(((po - pe) / (1 - pe)).toFixed(6)), po: Number(po.toFixed(6)), pe: Number(pe.toFixed(6)) }
}

const out = {
  warning: 'AI-agent vs AI-delegate agreement only. NOT human–agent agreement, NOT two-human kappa, NOT B4/B5 acceptance evidence. Both raters are AI; the delegate read the README that leaked the agent-label summary, so this is not independent labeling.',
  labelerA: a.labeler ?? 'agent',
  labelerB: d.labeler ?? 'unknown',
  cases: cases.length,
  fields: {},
}
let total = 0, agree = 0
for (const [name, get] of Object.entries(fields)) {
  const pairs = cases.map((c) => [get(a.cases[c]), get(d.cases[c])])
  const agreeField = pairs.filter(([x, y]) => JSON.stringify(x) === JSON.stringify(y)).length
  total += pairs.length; agree += agreeField
  out.fields[name] = {
    n: pairs.length,
    agreements: agreeField,
    agreementRate: Number((agreeField / pairs.length).toFixed(4)),
    ...kappa(pairs),
  }
}
out.total = { n: total, agreements: agree, agreementRate: Number((agree / total).toFixed(4)) }
writeFileSync('eval/evidence/b5blind/agreement-ai.json', JSON.stringify(out, null, 2) + '\n')
console.log(`[agreement-ai] cases=${out.cases} fields=${Object.keys(out.fields).length} total=${agree}/${total} (${(100 * agree / total).toFixed(1)}%)`)
console.log('[agreement-ai] descriptive only; not human-agent agreement, not kappa for B4')
