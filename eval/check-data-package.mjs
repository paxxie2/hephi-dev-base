#!/usr/bin/env node
// P14 数据包预检：脱敏交付包不得含密钥、不得在文件名/路径中暴露实验组别。
// 只读扫描目录；发现命中退出码 1，目录不存在退出码 2。
// 用法：node eval/check-data-package.mjs --package <dir>
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const root = arg('package')
if (!root) {
  console.error('usage: node eval/check-data-package.mjs --package <dir>')
  process.exit(2)
}
if (!existsSync(root)) {
  console.error(`数据包目录不存在：${root}`)
  process.exit(2)
}

const SECRET_PATTERNS = [
  ['github-token', /gh[opsu]_[A-Za-z0-9]{20,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['credential-assignment', /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i],
]
const GROUP_PATTERN = /(^|[\/._-])(off|hephi|shadow|control|baseline)([\/._-]|$)/i
const MAX_BYTES = 5 * 1024 * 1024

const findings = []
const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(dir, name)
    const rel = relative(root, path)
    if (GROUP_PATTERN.test(rel)) findings.push({ path: rel, kind: 'group-label' })
    const stat = statSync(path)
    if (stat.isDirectory()) {
      walk(path)
      continue
    }
    files.push(rel)
    if (stat.size > MAX_BYTES) continue
    const text = readFileSync(path, 'utf8')
    for (const [kind, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) findings.push({ path: rel, kind })
    }
  }
}
walk(root)

const result = { package: root, files: files.length, findings, ok: findings.length === 0 }
console.log(JSON.stringify(result, null, 2))
process.exit(findings.length === 0 ? 0 : 1)
