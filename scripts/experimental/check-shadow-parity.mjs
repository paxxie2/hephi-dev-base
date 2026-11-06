#!/usr/bin/env node
// P4 影子模式干净对照：比较三组“模型可见表面”（工具/Skill/系统提示）是否一致。
// 输入 JSON 由宿主调查导出：{ "tools": ["read", ...], "skills": ["hephi-superagent-control"], "promptSha256": "<64 hex>" }
// 用法：node scripts/experimental/check-shadow-parity.mjs --no-plugin <a.json> --no-label <b.json> --shadow <c.json>
import { existsSync, readFileSync } from 'node:fs'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}

const groups = { 'no-plugin': arg('no-plugin'), 'no-label': arg('no-label'), shadow: arg('shadow') }
for (const [name, file] of Object.entries(groups)) {
  if (!file) {
    console.error(`缺少 --${name} <json>`)
    process.exit(2)
  }
}

function load(name, file) {
  if (!existsSync(file)) {
    console.error(`${name} 文件不存在：${file}`)
    process.exit(2)
  }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`${name} 不是合法 JSON：${error.message}`)
    process.exit(2)
  }
  for (const key of ['tools', 'skills']) {
    if (!Array.isArray(data[key])) {
      console.error(`${name} 缺少 ${key} 数组`)
      process.exit(2)
    }
  }
  if (typeof data.promptSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(data.promptSha256)) {
    console.error(`${name} 缺少合法 promptSha256`)
    process.exit(2)
  }
  return {
    name,
    file,
    tools: [...new Set(data.tools)].sort(),
    skills: [...new Set(data.skills)].sort(),
    promptSha256: data.promptSha256,
  }
}

const loaded = Object.fromEntries(Object.entries(groups).map(([name, file]) => [name, load(name, file)]))
const base = loaded['no-plugin']
const diffs = []
for (const name of ['no-label', 'shadow']) {
  const other = loaded[name]
  for (const key of ['tools', 'skills']) {
    const onlyBase = base[key].filter((item) => !other[key].includes(item))
    const onlyOther = other[key].filter((item) => !base[key].includes(item))
    if (onlyBase.length > 0 || onlyOther.length > 0) {
      diffs.push({ group: name, kind: key, onlyNoPlugin: onlyBase, onlyOther })
    }
  }
  if (base.promptSha256 !== other.promptSha256) {
    diffs.push({ group: name, kind: 'promptSha256', noPlugin: base.promptSha256, other: other.promptSha256 })
  }
}

const result = {
  groups: Object.fromEntries(Object.entries(loaded).map(([name, group]) => [
    name,
    { file: group.file, tools: group.tools.length, skills: group.skills.length, promptSha256: group.promptSha256 },
  ])),
  diffs,
  ok: diffs.length === 0,
}
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
