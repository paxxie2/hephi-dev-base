#!/usr/bin/env node
// 乙5 / B7 复现包清单生成器（离线，只读元数据，不运行任何任务）.
//
// 目的：把一次 B5 计划的“复现包”固定成可审查的 manifest：输入 plan/tasks 的 sha256、
// 本地工具链版本（node/pnpm/python + requirements 固定版本 hash）、每个 task 的 base、
// 计划中的 run 列表、分析命令与原始记录路径占位。它**不**运行任务、不写运行记录、
// 不访问网络、不安装依赖；不能证明任何实验已经执行。
//
//   node eval/repro-manifest.mjs --plan <b5-plan.json> --tasks <tasks.json> --out <manifest.json>
//   node eval/repro-manifest.mjs --plan <b5-plan.json> --tasks <tasks.json> --dry-run
//   node eval/repro-manifest.mjs --self-test
//
// 输入：
//   --plan   由 eval/b5-plan.mjs 生成的 plan.json（schemaVersion/seed/groups/order + 每条 run）
//   --tasks  b5-plan 的 tasks.json（数组或 { "tasks": [...] }）
// 输出（manifest）：
//   versions（node/pnpm/python 实测版本 + eval/stats/requirements.txt 的 sha256 与固定 pins）、
//   inputs（plan/tasks 路径与 sha256）、tasks（taskId/repo/category/base，base 来自
//   eval/tasks/<...>/task.json）、runs（计划中的 run 列表 + recordPath 占位）、
//   analysis（report.py / kappa.py 命令模板，用占位符标出仍需 PREREG 锁定的参数）、
//   rawRecords（原始记录路径占位，本工具不创建目录/文件）。
//
// 退出码：
//   0  manifest 生成/打印成功（含 base 未解析等警告时仍为 0，会在 warnings 中记录）
//   1  运行时错误（IO 等不可归类为输入错误的失败）
//   2  参数错误、plan/tasks 不可读或非法、plan 与 tasks 不一致、任务索引冲突
//
// 边界：不运行实验任务、不创建批次目录、不写任何运行记录；版本探针只执行
// `node --version` / `pnpm --version` / `python3 --version`。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { PLAN_SCHEMA_VERSION, TASK_CATEGORIES } from './b5-plan.mjs'

export const SCHEMA_VERSION = 1
export const TOOL_NAME = 'eval/repro-manifest.mjs'
export const TOOL_VERSION = '1.0.0'
const SAFE_TASK_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
const BASE_COMMIT = /^[0-9a-f]{40}$/

export class UsageError extends Error {}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function readJson(filePath, label) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new UsageError(`cannot read ${label} ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    return { text, data: JSON.parse(text) }
  } catch (error) {
    throw new UsageError(`${label} is not valid JSON (${filePath}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function validateTasks(input) {
  const raw = Array.isArray(input) ? input : input?.tasks
  if (!Array.isArray(raw) || raw.length === 0) throw new UsageError('tasks must be a non-empty array (or { "tasks": [...] })')
  const tasks = []
  const seen = new Set()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new UsageError('each task must be an object with taskId/repo/category')
    const taskId = entry.taskId
    if (typeof taskId !== 'string' || !SAFE_TASK_ID.test(taskId)) throw new UsageError(`invalid taskId: ${String(taskId)}`)
    if (seen.has(taskId)) throw new UsageError(`duplicate taskId: ${taskId}`)
    seen.add(taskId)
    if (typeof entry.repo !== 'string' || !entry.repo.trim()) throw new UsageError(`task ${taskId}: repo must be a non-empty string`)
    if (!TASK_CATEGORIES.includes(entry.category)) throw new UsageError(`task ${taskId}: category must be one of ${TASK_CATEGORIES.join(', ')}`)
    tasks.push({ taskId, repo: entry.repo.trim(), category: entry.category })
  }
  return tasks
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new UsageError('plan must be a JSON object')
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) throw new UsageError(`plan.schemaVersion must be ${PLAN_SCHEMA_VERSION}, got ${String(plan.schemaVersion)}`)
  if (!Number.isSafeInteger(plan.seed)) throw new UsageError('plan.seed must be a safe integer')
  if (!Array.isArray(plan.groups) || plan.groups.length === 0) throw new UsageError('plan.groups must be a non-empty array')
  if (typeof plan.repeatFraction !== 'number' || plan.repeatFraction < 0 || plan.repeatFraction > 1) throw new UsageError('plan.repeatFraction must be a number between 0 and 1')
  if (!Array.isArray(plan.order) || plan.order.length === 0) throw new UsageError('plan.order must be a non-empty array')
  const seenRuns = new Set()
  for (const run of plan.order) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new UsageError('each plan.order entry must be an object')
    if (!Number.isSafeInteger(run.order) || run.order < 1) throw new UsageError(`invalid plan.order value: ${String(run.order)}`)
    if (typeof run.runId !== 'string' || !run.runId.trim()) throw new UsageError('each plan.order entry needs a non-empty runId')
    if (seenRuns.has(run.runId)) throw new UsageError(`duplicate runId in plan: ${run.runId}`)
    seenRuns.add(run.runId)
    if (typeof run.taskId !== 'string' || !run.taskId.trim()) throw new UsageError(`run ${run.runId}: missing taskId`)
    if (typeof run.group !== 'string' || !run.group.trim()) throw new UsageError(`run ${run.runId}: missing group`)
    if (!Number.isSafeInteger(run.repetition) || run.repetition < 1) throw new UsageError(`run ${run.runId}: repetition must be a positive integer`)
    if (typeof run.repeat !== 'boolean') throw new UsageError(`run ${run.runId}: repeat must be boolean`)
    if (run.arm !== undefined && run.arm !== run.group) throw new UsageError(`run ${run.runId}: arm must equal group`)
  }
  return plan
}

/** Index every task.json under eval/tasks by its taskId; relative paths stay repo-relative. */
export function collectTaskIndex(evalDir) {
  const tasksRoot = join(evalDir, 'tasks')
  const index = new Map()
  const conflicts = []
  const walk = (directory, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (entry.name !== 'task.json') continue
      let data
      try { data = JSON.parse(readFileSync(full, 'utf8')) } catch { continue }
      if (typeof data.taskId !== 'string') continue
      const record = {
        taskId: data.taskId,
        repo: typeof data.repo === 'string' ? data.repo : null,
        category: typeof data.category === 'string' ? data.category : null,
        base: typeof data.base === 'string' ? data.base : null,
        file: relative(dirname(evalDir), full).split(sep).join('/'),
      }
      if (index.has(record.taskId)) { conflicts.push(record.taskId); continue }
      index.set(record.taskId, record)
    }
  }
  walk(tasksRoot, 0)
  if (conflicts.length > 0) throw new UsageError(`duplicate taskId across eval/tasks task.json files: ${[...new Set(conflicts)].join(', ')}`)
  return index
}

function probeVersion(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 })
    const stdout = (result.stdout ?? '').trim()
    if (result.error || result.status !== 0) {
      return { command: [command, ...args].join(' '), available: false, version: null, error: result.error ? String(result.error.message) : `exit ${result.status}` }
    }
    const version = stdout.split(/\r?\n/)[0].trim()
    return { command: [command, ...args].join(' '), available: version !== '', version: version || null, error: version ? null : 'no version output' }
  } catch (error) {
    return { command: [command, ...args].join(' '), available: false, version: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function probeRequirements(evalDir, warnings) {
  const filePath = join(evalDir, 'stats', 'requirements.txt')
  if (!existsSync(filePath)) {
    warnings.push('eval/stats/requirements.txt 不存在：manifest 无法固定统计依赖版本')
    return { path: 'eval/stats/requirements.txt', available: false, sha256: null, pins: [], note: 'missing' }
  }
  const text = readFileSync(filePath, 'utf8')
  const pins = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => /^([A-Za-z0-9_.-]+)\s*==\s*([^\s#]+)/.exec(line))
    .filter(match => match !== null)
    .map(match => ({ name: match[1], version: match[2], pin: `${match[1]}==${match[2]}` }))
  if (pins.length === 0) warnings.push('eval/stats/requirements.txt 中没有解析到 `name==version` 固定版本行')
  return { path: 'eval/stats/requirements.txt', available: true, sha256: sha256Hex(text), pins }
}

function collectVersions(evalDir, warnings) {
  const nodeProbe = probeVersion(process.execPath, ['--version'])
  return {
    note: '版本探针只执行 node/pnpm/python3 --version，不安装依赖、不访问网络、不运行实验任务。',
    node: { command: 'node --version', available: true, version: process.version },
    nodeExecutable: { command: `${process.execPath} --version`, available: nodeProbe.available, version: nodeProbe.version },
    pnpm: probeVersion('pnpm'),
    python3: probeVersion('python3'),
    requirements: probeRequirements(evalDir, warnings),
    platform: { os: process.platform, arch: process.arch, release: typeof process.release === 'object' ? process.release.name : null },
  }
}

function planRunIdOrder(plan) {
  return plan.order.map(run => run.order)
}

/**
 * Build the repro manifest. `now` injectable for deterministic tests.
 * This function only reads metadata; it never runs a plan task.
 */
export function buildManifest({ plan, tasks, planPath, tasksPath, evalDir, now = new Date().toISOString() }) {
  const warnings = []
  const taskIndex = collectTaskIndex(evalDir)
  const tasksById = new Map(tasks.map(task => [task.taskId, task]))

  const plannedTaskIds = [...new Set(plan.order.map(run => run.taskId))]
  const missingFromTasks = plannedTaskIds.filter(taskId => !tasksById.has(taskId))
  if (missingFromTasks.length > 0) throw new UsageError(`plan references taskId(s) missing from --tasks: ${missingFromTasks.join(', ')}`)
  const unusedTasks = tasks.map(task => task.taskId).filter(taskId => !plannedTaskIds.includes(taskId))
  if (unusedTasks.length > 0) throw new UsageError(`--tasks contains taskId(s) not used by the plan: ${unusedTasks.join(', ')}`)

  const manifestTasks = plannedTaskIds.map(taskId => {
    const task = tasksById.get(taskId)
    const indexed = taskIndex.get(taskId) ?? null
    let base = null
    let baseSource = null
    if (indexed === null) {
      warnings.push(`task ${taskId}: 未在 eval/tasks/**/task.json 中找到任务元数据，base 记为 null（未解析）`)
    } else {
      if (indexed.repo !== null && indexed.repo !== task.repo) warnings.push(`task ${taskId}: repo 不一致（tasks=${task.repo}, task.json=${indexed.repo}）`)
      if (indexed.category !== null && indexed.category !== task.category) warnings.push(`task ${taskId}: category 不一致（tasks=${task.category}, task.json=${indexed.category}）`)
      if (indexed.base !== null && BASE_COMMIT.test(indexed.base)) {
        base = indexed.base
        baseSource = indexed.file
      } else if (indexed.base !== null) {
        warnings.push(`task ${taskId}: task.json base 不是 40-hex commit（${indexed.base}），base 记为 null`)
      } else {
        warnings.push(`task ${taskId}: task.json 缺少 base 字段，base 记为 null`)
      }
    }
    return { taskId, repo: task.repo, category: task.category, base, baseSource }
  })

  const runs = plan.order.map(run => ({
    order: run.order,
    runId: run.runId,
    taskId: run.taskId,
    group: run.group,
    arm: run.group,
    repetition: run.repetition,
    repeat: run.repeat,
    recordPath: `<batch>/runs/${run.runId}.json`,
  }))
  const perGroup = {}
  for (const run of runs) perGroup[run.group] = (perGroup[run.group] ?? 0) + 1
  const repeatRuns = runs.filter(run => run.repeat).length

  const orderValues = planRunIdOrder(plan)
  const contiguous = orderValues.every((value, index) => value === index + 1)
  if (!contiguous) warnings.push('plan.order 的 order 值不是从 1 连续递增；manifest 按 plan 原顺序记录，不做重排')

  const seed = plan.seed
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'b5-repro-manifest',
    generator: TOOL_NAME,
    generatorVersion: TOOL_VERSION,
    generatedAt: now,
    disclaimer: '本清单是复现包元数据；不运行任务、不产生运行记录、不证明任何实验已执行或已复现。',
    execution: {
      tasksExecuted: false,
      versionProbesExecuted: ['node --version', 'pnpm --version', 'python3 --version'],
      note: '只有版本探针被执行；计划中的任何 run 均未运行。',
    },
    inputs: {
      plan: {
        path: resolve(planPath),
        sha256: sha256Hex(readFileSync(planPath, 'utf8')),
        schemaVersion: plan.schemaVersion,
        generatedBy: plan.generatedBy ?? null,
        generatedAt: plan.generatedAt ?? null,
        seed,
        groups: plan.groups,
        repeatFraction: plan.repeatFraction,
      },
      tasks: {
        path: resolve(tasksPath),
        sha256: sha256Hex(readFileSync(tasksPath, 'utf8')),
        count: tasks.length,
        taskIds: tasks.map(task => task.taskId),
      },
    },
    versions: collectVersions(evalDir, warnings),
    preregLock: {
      path: 'eval/PREREG.lock',
      present: existsSync(join(evalDir, 'PREREG.lock')),
      note: '正式分析前必须存在已锁定 PREREG；本工具不生成、不验证负责人批准。',
    },
    taskSet: {
      taskCount: manifestTasks.length,
      repos: [...new Set(manifestTasks.map(task => task.repo))].sort(),
      categoryCounts: manifestTasks.reduce((acc, task) => { acc[task.category] = (acc[task.category] ?? 0) + 1; return acc }, {}),
    },
    tasks: manifestTasks,
    runs,
    rawRecords: {
      batchDirPlaceholder: 'eval/evidence/<batch>',
      pathTemplate: 'eval/evidence/<batch>/runs/<runId>.json',
      note: '占位：批次目录由负责人命名并归档；本工具不创建目录、不写运行记录。',
    },
    analysis: {
      prerequisite: '需先存在 eval/PREREG.lock；<PREREG D-1>/<PREREG D-4> 等参数必须来自负责人批准并锁定的 PREREG，不得由脚本猜测。',
      dependencySetup: {
        command: 'python3 -m venv .venv && .venv/bin/pip install -r eval/stats/requirements.txt',
        note: '固定版本见 versions.requirements.pins 与 sha256。',
      },
      stats: {
        command: `.venv/bin/python eval/stats/report.py --input <batch>/runs.json --format markdown --out <batch>/report.md --seed ${seed} --min-pairs <PREREG D-4> --noninferiority-margin <PREREG D-1>`,
        inputs: ['<batch>/runs.json（run.schema.json 记录数组）'],
        outputs: ['<batch>/report.md'],
      },
      kappa: {
        command: 'node eval/kappa.mjs --scores <batch>/labels-pair.json --min 0.7',
        inputs: ['<batch>/labels-pair.json（两名盲评者的 labels/items/raterA/raterB）'],
        outputs: ['stdout 摘要；进入主分析前须达到 min 0.7'],
      },
    },
    summary: {
      tasks: manifestTasks.length,
      runs: runs.length,
      primaryRuns: runs.length - repeatRuns,
      repeatRuns,
      perGroup,
      repeatFraction: plan.repeatFraction,
      seed,
    },
    warnings,
  }
}

export function parseArgs(argv) {
  const options = {
    evalDir: dirname(fileURLToPath(import.meta.url)),
    plan: null,
    tasks: null,
    out: null,
    dryRun: false,
    selfTest: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') { options.selfTest = true; continue }
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (!['--plan', '--tasks', '--out', '--eval-dir'].includes(arg)) throw new UsageError(`unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined) throw new UsageError(`missing value for ${arg}`)
    index += 1
    if (arg === '--plan') options.plan = value
    if (arg === '--tasks') options.tasks = value
    if (arg === '--out') options.out = value
    if (arg === '--eval-dir') options.evalDir = resolve(value)
  }
  if (options.selfTest || options.help) return options
  if (options.plan === null) throw new UsageError('--plan is required')
  if (options.tasks === null) throw new UsageError('--tasks is required')
  if (options.out === null && !options.dryRun) throw new UsageError('--out is required unless --dry-run is used')
  return options
}

function usage() {
  return [
    'usage: node eval/repro-manifest.mjs --plan <b5-plan.json> --tasks <tasks.json> --out <manifest.json>',
    '       node eval/repro-manifest.mjs --plan <b5-plan.json> --tasks <tasks.json> --dry-run',
    '       node eval/repro-manifest.mjs --self-test',
    '',
    '只读元数据：记录 plan/tasks sha256、版本、taskId/base、run 列表、分析命令与记录路径占位；',
    '不运行任何任务、不创建批次目录、不访问网络。',
  ].join('\n')
}

function writeManifest(outPath, manifest) {
  const absolute = resolve(outPath)
  const directory = dirname(absolute)
  mkdirSync(directory, { recursive: true })
  const temp = join(directory, `.${basename(absolute)}.tmp-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`)
    renameSync(temp, absolute)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
  return absolute
}

// ---------------------------------------------------------------------------
// Self-test: synthetic plan/tasks/eval dir; never touches real eval metadata.
// ---------------------------------------------------------------------------
function pass(results, name, condition, detail = '') {
  if (condition) { results.push(`PASS ${name}`); return }
  results.push(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}

function spawnCli(args) {
  const scriptPath = fileURLToPath(import.meta.url)
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { status: typeof result.status === 'number' ? result.status : null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const BASE_ALPHA = 'a'.repeat(40)
const BASE_BETA = 'b'.repeat(40)

function makeSyntheticPlan() {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    generatedBy: 'eval/b5-plan.mjs',
    generatedAt: '2026-11-07T00:00:00.000Z',
    seed: 20261107,
    groups: ['off', 'native'],
    repeatFraction: 0.2,
    taskSet: { taskCount: 2, taskIds: ['alpha-task', 'beta-task'], repos: ['alpha', 'beta'] },
    repeats: ['beta-task'],
    order: [
      { order: 1, runId: 'b5-20261107-0001-alpha-task-off-r1', taskId: 'alpha-task', repo: 'alpha', category: 'defect-fix', group: 'off', arm: 'off', repeat: false, repetition: 1, seed: 20261107 },
      { order: 2, runId: 'b5-20261107-0002-alpha-task-native-r1', taskId: 'alpha-task', repo: 'alpha', category: 'defect-fix', group: 'native', arm: 'native', repeat: false, repetition: 1, seed: 20261107 },
      { order: 3, runId: 'b5-20261107-0003-beta-task-native-r1', taskId: 'beta-task', repo: 'beta', category: 'new-feature', group: 'native', arm: 'native', repeat: false, repetition: 1, seed: 20261107 },
      { order: 4, runId: 'b5-20261107-0004-beta-task-off-r1', taskId: 'beta-task', repo: 'beta', category: 'new-feature', group: 'off', arm: 'off', repeat: false, repetition: 1, seed: 20261107 },
      { order: 5, runId: 'b5-20261107-0005-beta-task-off-r2', taskId: 'beta-task', repo: 'beta', category: 'new-feature', group: 'off', arm: 'off', repeat: true, repetition: 2, seed: 20261107 },
      { order: 6, runId: 'b5-20261107-0006-beta-task-native-r2', taskId: 'beta-task', repo: 'beta', category: 'new-feature', group: 'native', arm: 'native', repeat: true, repetition: 2, seed: 20261107 },
    ],
    summary: { runs: 6, primaryRuns: 4, repeatRuns: 2, perGroup: { off: 3, native: 3 }, repeatTasks: 1 },
  }
}

function makeSyntheticTasks() {
  return {
    tasks: [
      { taskId: 'alpha-task', repo: 'alpha', category: 'defect-fix' },
      { taskId: 'beta-task', repo: 'beta', category: 'new-feature' },
    ],
  }
}

function setupSyntheticEvalDir(root) {
  const evalDir = join(root, 'eval')
  mkdirSync(join(evalDir, 'tasks', 'alpha', 'alpha-task'), { recursive: true })
  mkdirSync(join(evalDir, 'tasks', 'beta', 'beta-task'), { recursive: true })
  mkdirSync(join(evalDir, 'stats'), { recursive: true })
  writeFileSync(join(evalDir, 'tasks', 'alpha', 'alpha-task', 'task.json'), JSON.stringify({ taskId: 'alpha-task', repo: 'alpha', category: 'defect-fix', base: BASE_ALPHA }))
  writeFileSync(join(evalDir, 'tasks', 'beta', 'beta-task', 'task.json'), JSON.stringify({ taskId: 'beta-task', repo: 'beta', category: 'new-feature', base: BASE_BETA }))
  writeFileSync(join(evalDir, 'stats', 'requirements.txt'), '# synthetic requirements\n\nnumpy==2.3.4\nscipy==1.16.2\nstatsmodels==0.14.5\n')
  return evalDir
}

function snapshotRealFiles() {
  const evalDir = dirname(fileURLToPath(import.meta.url))
  const files = [join(evalDir, 'stats', 'requirements.txt'), join(evalDir, 'b5-plan.mjs')]
  return files.map(filePath => {
    try {
      const info = statSync(filePath)
      return { filePath, mtimeMs: info.mtimeMs, size: info.size, sha256: sha256Hex(readFileSync(filePath, 'utf8')) }
    } catch {
      return { filePath, missing: true }
    }
  })
}

export function selfTest() {
  const results = []
  const root = mkdtempSync(join(tmpdir(), 'repro-manifest-self-'))
  const realBefore = snapshotRealFiles()
  try {
    const evalDir = setupSyntheticEvalDir(root)
    const plan = makeSyntheticPlan()
    const tasksFile = makeSyntheticTasks()
    const planPath = join(root, 'plan.json')
    const tasksPath = join(root, 'tasks.json')
    writeFileSync(planPath, JSON.stringify(plan, null, 2))
    writeFileSync(tasksPath, JSON.stringify(tasksFile, null, 2))
    const fixedNow = '2026-11-07T00:00:00.000Z'
    const build = () => buildManifest({ plan: validatePlan(JSON.parse(readFileSync(planPath, 'utf8'))), tasks: validateTasks(tasksFile), planPath, tasksPath, evalDir, now: fixedNow })

    const manifest = build()
    pass(results, 'manifest has schemaVersion/generator/generatedAt', manifest.schemaVersion === 1 && manifest.generator === TOOL_NAME && manifest.generatedAt === fixedNow)
    pass(results, 'manifest records node/pnpm/python versions (probes only)', manifest.versions.node.version === process.version && typeof manifest.versions.pnpm.available === 'boolean' && typeof manifest.versions.python3.available === 'boolean', JSON.stringify(manifest.versions.pnpm))
    pass(results, 'manifest records requirements sha256 and fixed pins', /^[0-9a-f]{64}$/.test(manifest.versions.requirements.sha256) && manifest.versions.requirements.pins.some(pin => pin.pin === 'numpy==2.3.4'))
    pass(results, 'manifest records plan/tasks sha256', /^[0-9a-f]{64}$/.test(manifest.inputs.plan.sha256) && /^[0-9a-f]{64}$/.test(manifest.inputs.tasks.sha256))
    pass(results, 'manifest resolves taskId/base from task.json', manifest.tasks.length === 2 && manifest.tasks.find(task => task.taskId === 'alpha-task').base === BASE_ALPHA && manifest.tasks.find(task => task.taskId === 'beta-task').baseSource === 'eval/tasks/beta/beta-task/task.json')
    pass(results, 'manifest runs mirror the plan order and runIds', manifest.runs.length === plan.order.length && manifest.runs.map(run => run.order).join(',') === '1,2,3,4,5,6' && manifest.runs[0].runId === plan.order[0].runId)
    pass(results, 'manifest run record paths are unique placeholders', new Set(manifest.runs.map(run => run.recordPath)).size === manifest.runs.length && manifest.runs.every(run => run.recordPath === `<batch>/runs/${run.runId}.json`))
    pass(results, 'manifest says no task was executed', manifest.execution.tasksExecuted === false && manifest.execution.versionProbesExecuted.length === 3)
    pass(results, 'manifest summary counts groups and repeats', manifest.summary.runs === 6 && manifest.summary.repeatRuns === 2 && manifest.summary.perGroup.off === 3 && manifest.summary.perGroup.native === 3)
    pass(results, 'analysis commands carry seed and PREREG placeholders', manifest.analysis.stats.command.includes(`--seed ${plan.seed}`) && manifest.analysis.stats.command.includes('<PREREG D-1>') && manifest.analysis.kappa.command.includes('eval/kappa.mjs'))
    pass(results, 'manifest notes prereg lock requirement and raw record placeholders', manifest.analysis.prerequisite.includes('eval/PREREG.lock') && manifest.rawRecords.pathTemplate.includes('<batch>') && manifest.preregLock.present === false)
    pass(results, 'manifest is deterministic for identical inputs (generatedAt fixed)', JSON.stringify(manifest) === JSON.stringify(build()))

    // Missing task.json -> base null + warning, still succeeds.
    const noMetaRoot = mkdtempSync(join(root, 'no-meta-'))
    const noMetaEval = join(noMetaRoot, 'eval')
    mkdirSync(join(noMetaEval, 'stats'), { recursive: true })
    writeFileSync(join(noMetaEval, 'stats', 'requirements.txt'), 'numpy==2.3.4\n')
    const noMeta = buildManifest({ plan, tasks: validateTasks(tasksFile), planPath, tasksPath, evalDir: noMetaEval, now: fixedNow })
    pass(results, 'missing task.json records base=null and a warning', noMeta.tasks.every(task => task.base === null) && noMeta.warnings.some(warning => warning.includes('base 记为 null')))

    // CLI --out / --dry-run.
    const outPath = join(root, 'manifest.json')
    const outRun = spawnCli(['--plan', planPath, '--tasks', tasksPath, '--out', outPath, '--eval-dir', evalDir])
    const cliManifest = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null
    pass(results, 'CLI --out writes a parseable manifest', outRun.status === 0 && cliManifest !== null && cliManifest.runs.length === 6, `status=${outRun.status} stderr=${outRun.stderr}`)
    const dryPath = join(root, 'dry.json')
    const dryRun = spawnCli(['--plan', planPath, '--tasks', tasksPath, '--dry-run', '--eval-dir', evalDir])
    pass(results, 'CLI --dry-run prints the manifest and writes nothing', dryRun.status === 0 && !existsSync(dryPath) && JSON.parse(dryRun.stdout).runs.length === 6)

    // The manifest is metadata only: no directory/file created by the build.
    const beforeFiles = readdirSync(root).sort().join(',')
    build()
    pass(results, 'building the manifest creates no files/directories', readdirSync(root).sort().join(',') === beforeFiles)

    // Invalid inputs exit 2.
    const writeJson = (name, data) => { const path = join(root, name); writeFileSync(path, JSON.stringify(data)); return path }
    const failCases = [
      ['missing --plan', ['--tasks', tasksPath, '--out', join(root, 'x.json')]],
      ['unknown argument', ['--plan', planPath, '--tasks', tasksPath, '--out', join(root, 'x.json'), '--bogus']],
      ['missing --out value', ['--plan', planPath, '--tasks', tasksPath, '--out']],
      ['nonexistent plan', ['--plan', join(root, 'nope.json'), '--tasks', tasksPath, '--out', join(root, 'x.json')]],
      ['malformed plan', ['--plan', (() => { const p = join(root, 'bad-plan.json'); writeFileSync(p, '{not json'); return p })(), '--tasks', tasksPath, '--out', join(root, 'x.json')]],
      ['plan references unknown task', ['--plan', writeJson('unknown-plan.json', { ...plan, order: [{ ...plan.order[0], taskId: 'gamma-task' }] }), '--tasks', tasksPath, '--out', join(root, 'x.json')]],
      ['tasks has extra task not in plan', ['--plan', planPath, '--tasks', writeJson('extra-tasks.json', { tasks: [...tasksFile.tasks, { taskId: 'gamma-task', repo: 'gamma', category: 'new-feature' }] }), '--out', join(root, 'x.json')]],
      ['duplicate runId', ['--plan', writeJson('dup-run.json', { ...plan, order: [...plan.order, { ...plan.order[0] }] }), '--tasks', tasksPath, '--out', join(root, 'x.json')]],
      ['bad plan schemaVersion', ['--plan', writeJson('bad-version.json', { ...plan, schemaVersion: 2 }), '--tasks', tasksPath, '--out', join(root, 'x.json')]],
      ['missing --out without --dry-run', ['--plan', planPath, '--tasks', tasksPath]],
    ]
    for (const [name, args] of failCases) {
      const run = spawnCli(args)
      pass(results, `CLI rejects ${name} (exit 2)`, run.status === 2, `status=${run.status} stderr=${run.stderr}`)
    }

    // Self-test must not read/modify real eval metadata.
    const realAfter = snapshotRealFiles()
    pass(results, 'self-test does not modify real eval files', JSON.stringify(realBefore) === JSON.stringify(realAfter), JSON.stringify({ realBefore, realAfter }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  for (const line of results) console.log(line)
  const failed = results.filter(line => line.startsWith('FAIL')).length
  if (failed > 0) {
    console.log(`\nFAILED: ${failed} assertion(s)`)
    return 1
  }
  console.log(`\nPASS: ${results.length} assertions (repro-manifest self-test; synthetic fixtures only)`)
  return 0
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options = null
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    process.exitCode = 2
  }
  if (options) {
    if (options.help) {
      console.log(usage())
      process.exitCode = 0
    } else if (options.selfTest) {
      process.exitCode = selfTest()
    } else {
      try {
        const planFile = readJson(options.plan, '--plan')
        const tasksFile = readJson(options.tasks, '--tasks')
        const plan = validatePlan(planFile.data)
        const tasks = validateTasks(tasksFile.data)
        const manifest = buildManifest({ plan, tasks, planPath: options.plan, tasksPath: options.tasks, evalDir: options.evalDir })
        if (options.dryRun) {
          console.log(JSON.stringify(manifest, null, 2))
          console.error('[repro-manifest] DRY-RUN: nothing written (no task was executed)')
        } else {
          const written = writeManifest(options.out, manifest)
          console.log(JSON.stringify({ out: written, tasks: manifest.summary.tasks, runs: manifest.summary.runs, warnings: manifest.warnings.length, tasksExecuted: false }, null, 2))
        }
        process.exitCode = 0
      } catch (error) {
        console.error(`[repro-manifest] ERROR: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = error instanceof UsageError ? 2 : 1
      }
    }
  }
}
