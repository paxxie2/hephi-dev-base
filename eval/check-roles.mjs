#!/usr/bin/env node
// P12 人员与职责冲突检查：作者不得兼任该任务范围评审；盲评者不得参与开发；裁决者不得兼任盲评者。
// 输入 JSON：eval/ROLES.json
// {
//   "people": [{ "id": "p1", "develops": true, "blindRater": false, "adjudicator": false }],
//   "tasks": [{ "id": "t1", "author": "p1", "scopeReviewer": "p2" }],
//   "scoring": { "blindRaters": ["p3", "p4"], "adjudicator": "p5" }
// }
// 用法：node eval/check-roles.mjs [--roles eval/ROLES.json]
import { existsSync, readFileSync } from 'node:fs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const file = arg('roles', 'eval/ROLES.json')
if (!existsSync(file)) {
  console.error(`人员文件不存在：${file}（需要真实人员确认后才可执行）`)
  process.exit(2)
}

const problems = []
let data
try {
  data = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`ROLES 不是合法 JSON：${error.message}`)
  process.exit(2)
}

const people = new Map()
for (const person of Array.isArray(data.people) ? data.people : []) {
  if (!person.id) problems.push('存在无 id 的人员')
  if (people.has(person.id)) problems.push(`人员 id 重复：${person.id}`)
  people.set(person.id, person)
}

const tasks = Array.isArray(data.tasks) ? data.tasks : []
const authors = new Set()
for (const task of tasks) {
  const author = people.get(task.author)
  const reviewer = people.get(task.scopeReviewer)
  if (!author) problems.push(`任务 ${task.id} 的作者 ${task.author} 不在人员表`)
  if (!reviewer) problems.push(`任务 ${task.id} 的范围评审 ${task.scopeReviewer} 不在人员表`)
  if (task.author === task.scopeReviewer) problems.push(`任务 ${task.id} 作者兼任范围评审`)
  authors.add(task.author)
}

const scoring = data.scoring ?? {}
const raters = Array.isArray(scoring.blindRaters) ? scoring.blindRaters : []
if (raters.length < 2) problems.push(`盲评者不足 2 人（当前 ${raters.length}）`)
if (new Set(raters).size !== raters.length) problems.push('盲评者存在重复')
for (const id of raters) {
  const person = people.get(id)
  if (!person) problems.push(`盲评者 ${id} 不在人员表`)
  else {
    if (person.develops === true) problems.push(`盲评者 ${id} 参与开发`)
    if (person.adjudicator === true) problems.push(`盲评者 ${id} 兼任裁决者`)
  }
}
if (scoring.adjudicator) {
  if (!people.has(scoring.adjudicator)) problems.push(`裁决者 ${scoring.adjudicator} 不在人员表`)
  if (raters.includes(scoring.adjudicator)) problems.push('裁决者不能是盲评者之一')
  if (authors.has(scoring.adjudicator)) problems.push('裁决者不能是任务作者')
} else {
  problems.push('缺少裁决者')
}

// 试跑门槛只需作者与范围评审到位；正式实验还需全部角色与 kappa。这里只检查结构完整性。
const result = { file, people: people.size, tasks: tasks.length, blindRaters: raters.length, problems, ok: problems.length === 0 }
console.log(JSON.stringify(result, null, 2))
process.exit(problems.length === 0 ? 0 : 1)
