#!/usr/bin/env node
// Independent leak scan for B5 blind materials (defence-in-depth on top of export.mjs's own scan).
//
// Usage: node eval/evidence/b5blind/leak-scan.mjs [materialsDir]
// Exit: 0 = no group-revealing traces; 1 = trace found.
//
// HARD = any trace that could reveal arm/repo/PR/branch/run identity. Fail-closed.
// NOTE = common task artifacts shared by all cases (e.g. the task base SHA in the
//        approved-scope task card). They are identical across all 8 cases and therefore
//        do not discriminate between groups; reported but not fatal (documented in README).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.argv[2] ?? 'eval/evidence/b5blind/materials'
const HARD = [
  ['hephi', /hephi/i],
  ['hephi-zh', /赫菲/],
  ['native-word', /(?<![\w-])native(?![\w-])/i],
  ['off-word', /(?<![\w-])off(?![\w-])/i],
  ['staged-word', /(?<![\w-])staged(?![\w-])/i],
  ['shadow-word', /(?<![\w-])shadow(?![\w-])/i],
  ['arm-assign', /\barm\s*[=:]\s*(?:off|native|staged)\b/i],
  ['branch-ref', /\b(?:agent|docs|codex|fix|feat)\/[a-z0-9][a-z0-9._-]*/i],
  ['pr-url', /github\.com\/[^\s)]+|\bpull\/\d+\b/i],
  ['pr-number', /\bpr\s*#?\d+\b/i],
  ['repo-native', /b5-native/i],
  ['repo-off', /b5-off/i],
  ['roadmap', /ROADMAP[-_ ]?95/i],
  ['decisions-log', /decisions\.jsonl/i],
  ['run-id', /"runId"\s*:/],
  ['task-id', /"taskId"\s*:/],
  ['arm-key', /"arm"\s*:/],
  ['mapping-file', /private-mapping|source-evidence/],
  ['tmp-path', /\/tmp\/|b5blind-work/],
  ['commit-sha40', /\b[0-9a-f]{40}\b/],
]
const NOTES = [
  // The approved-scope task card (same bytes for all cases) contains the task base SHA.
  ['task-base-sha-in-approved-scope', /base:\s*`1e166fbe2217ac378e5bb7062cd34a2da1e75e6f`/],
]

const files = []
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(ROOT)

const hardFindings = []
const notes = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [id, re] of HARD) {
    for (let i = 0; i < lines.length; i += 1) {
      if (!re.test(lines[i])) continue
      // Shared task artifacts are recorded as NOTE and are not group-discriminating.
      if (NOTES.some(([, noteRe]) => noteRe.test(lines[i]))) continue
      hardFindings.push({ file, line: i + 1, pattern: id, excerpt: lines[i].trim().slice(0, 160) })
      break
    }
  }
  for (const [id, re] of NOTES) {
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) { notes.push({ file, line: i + 1, pattern: id }); break }
    }
  }
}

console.log('# B5 blind materials independent leak scan')
console.log(`materials=${ROOT}`)
console.log(`files=${files.length}`)
console.log(`hardFindings=${hardFindings.length}`)
for (const hit of hardFindings) console.log(`HARD ${hit.file}:${hit.line} [${hit.pattern}] ${hit.excerpt}`)
console.log(`notes=${notes.length} (shared task artifacts; identical across all cases, not group-discriminating)`)
for (const note of notes) console.log(`NOTE ${note.file}:${note.line} [${note.pattern}]`)
console.log(hardFindings.length === 0 ? 'RESULT: PASS (no group-revealing trace)' : 'RESULT: FAIL')
process.exit(hardFindings.length === 0 ? 0 : 1)
