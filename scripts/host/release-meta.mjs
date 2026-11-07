#!/usr/bin/env node
// 发布包元数据与校验工具（deploy-hephi.sh 专用，零依赖、只读校验 + 只写 incoming 目录）。
//
// 子命令：
//   prepare --build <dir> --incoming <dir> --sha <40hex> --tree <40hex>
//           --host-version <v> --node <path> --node-version <v> --peer-root <dir|"">
//     读取构建目录的 package.json/pnpm-lock.yaml，把生产依赖与显式 peer 解析写进
//     incoming：创建 incoming/node_modules/<peer> -> <peer-root>/<peer> 的符号链接，
//     校验每个 dependencies 都已随包，计算 node_modules 树哈希与 index/tools 入口哈希，
//     最后写 incoming/meta.json。
//   check --release <dir> --sha <sha> [--allow-legacy-rollback]
//     校验不可变 release：meta 基本字段、入口哈希、依赖锁文件/树哈希、peer 链接。
//     formatVersion:2 必须完整；历史 formatVersion:1 只在显式 --allow-legacy-rollback
//     （回滚/恢复上下文）下接受：三段齐全的旧产物按完整字段校验并要求双入口激活，
//     三段全无的纯 legacy 按历史 entrySha256 校验；部分残缺一律拒绝。
//   activation --release <dir> [--allow-legacy-rollback]
//     输出 required:<entry,...>、legacy、invalid 或 none，供部署脚本判定激活门禁。
//     legacy（health-only）只在显式 --allow-legacy-rollback 的纯历史 v1 下输出；
//     三段齐全的 v1 与 v2 一样输出 required；缺字段/未知版本/未授权旧格式一律 invalid。
//   tree-hash --dir <dir>
//     输出目录的确定性树哈希（文件内容 + 符号链接目标），不存在时输出 null。
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const META_FORMAT_VERSION = 2
const LEGACY_FORMAT_VERSION = 1

function fail(message) {
  console.error(message)
  process.exit(1)
}

function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) fail(`unexpected argument: ${key}`)
    const value = argv[i + 1]
    // --allow-legacy-rollback 是唯一无值选项；其余选项仍要求显式值。
    if (value === undefined || value.startsWith('--')) {
      if (key === '--allow-legacy-rollback') {
        out['allow-legacy-rollback'] = true
        continue
      }
      fail(`missing value for ${key}`)
    }
    out[key.slice(2)] = value
    i += 1
  }
  return out
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function treeHash(root) {
  if (!existsSync(root)) return null
  const rows = []
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name)
      const row = rel === '' ? name : `${rel}/${name}`
      const stat = lstatSync(file)
      if (stat.isSymbolicLink()) {
        rows.push(`${row}|link|${readlinkSync(file)}`)
      } else if (stat.isDirectory()) {
        walk(file, row)
      } else {
        rows.push(`${row}|file|${sha256File(file)}`)
      }
    }
  }
  walk(root, '')
  return createHash('sha256').update(rows.join('\n')).digest('hex')
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`cannot read JSON ${file}: ${error.message}`)
  }
}

function lstatExists(file) {
  try {
    lstatSync(file)
    return true
  } catch {
    return false
  }
}

function shaOf(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) fail(`${label} must be a full 40-char SHA, got ${String(value)}`)
  return value
}

function entryFiles() {
  return ['index', 'tools']
}

function prepare(options) {
  const buildDir = resolve(options.build)
  const incoming = resolve(options.incoming)
  const sha = shaOf(options.sha, '--sha')
  const tree = shaOf(options['tree'], '--tree')
  const hostVersion = options['host-version']
  if (typeof hostVersion !== 'string' || hostVersion.trim() === '') fail('--host-version must be a non-empty single-line value')
  const nodeCommand = options.node ?? 'node'
  const nodeVersion = options['node-version'] ?? 'unknown'
  const peerRoot = options['peer-root'] ?? ''
  const pkg = readJson(join(buildDir, 'package.json'))
  const lockfile = join(incoming, 'pnpm-lock.yaml')
  if (!existsSync(lockfile)) fail(`the release copy is missing pnpm-lock.yaml: ${lockfile}`)

  // 1) 生产依赖必须已从同一冻结 lockfile 打进 incoming（不依赖源码工作区 node_modules）。
  //    版本在 peer 链接之后读取：同名依赖被宿主 peer 覆盖时，记录的是最终随包版本。

  // 2) peer 解析必须显式：链接到部署时提供的宿主 peer 根，不猜、不依赖源码 node_modules。
  const peers = {}
  const peersReplaced = []
  const peerDependencies = pkg.peerDependencies ?? {}
  const peerMeta = pkg.peerDependenciesMeta ?? {}
  if (Object.keys(peerDependencies).length > 0 && peerRoot === '') {
    fail('package.json declares peerDependencies; --peer-root <dir> is required so peer resolution is explicit')
  }
  if (peerRoot !== '') {
    for (const name of Object.keys(peerDependencies)) {
      const target = join(peerRoot, name)
      const optional = peerMeta[name]?.optional === true
      if (!existsSync(join(target, 'package.json'))) {
        if (optional) {
          peers[name] = 'optional-missing'
          continue
        }
        fail(`host peer package is missing in --peer-root ${peerRoot}: ${name}`)
      }
      const dest = join(incoming, 'node_modules', name)
      mkdirSync(join(dest, '..'), { recursive: true })
      // 生产安装可能已把同名包放进 incoming（autoInstallPeers 或它同时是生产依赖）。
      // 只在 incoming 内替换该入口，再显式链接 --peer-root；不改构建目录、不改宿主。
      if (lstatExists(dest)) {
        rmSync(dest, { recursive: true, force: true })
        peersReplaced.push(name)
      }
      symlinkSync(target, dest)
      peers[name] = target
    }
  }

  // 3) 校验并记录最终随包的生产依赖版本（含被宿主 peer 覆盖后的版本）。
  const resolved = {}
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const file = join(incoming, 'node_modules', name, 'package.json')
    if (!existsSync(file)) fail(`production dependency was not packaged for ${sha}: ${name}`)
    resolved[name] = readJson(file).version ?? null
  }

  // 3) 入口哈希（index + tools）与依赖树哈希进入不可变 meta，后续校验可发现篡改。
  const entries = {}
  for (const name of entryFiles()) {
    const file = join(incoming, 'lib', `${name}.mjs`)
    if (!existsSync(file)) fail(`the build produced no lib/${name}.mjs for ${sha}`)
    entries[name] = sha256File(file)
  }
  // F2: the dependency-tree hash is required for the immutable meta; a release without a
  // packaged node_modules tree cannot be validated later, so prepare must fail here instead
  // of writing a null hash that later skips the tree comparison.
  const nodeModulesSha256 = treeHash(join(incoming, 'node_modules'))
  if (nodeModulesSha256 === null) fail(`the incoming release has no node_modules tree to hash: ${join(incoming, 'node_modules')}`)
  const meta = {
    formatVersion: META_FORMAT_VERSION,
    pluginCommit: sha,
    sourceTree: tree,
    entrySha256: entries.index,
    entries,
    builtAt: new Date().toISOString(),
    buildCommand: 'pnpm install --frozen-lockfile && pnpm check && pnpm install --prod --frozen-lockfile --offline',
    hostVersion,
    source: 'git-archive',
    node: { command: nodeCommand, version: nodeVersion },
    activation: { markerVersion: 1, entries: entryFiles(), marker: '[hephi-activation]' },
    dependencies: {
      lockfileSha256: sha256File(lockfile),
      nodeModulesSha256,
      resolved,
      peers,
      peersReplaced,
    },
  }
  writeFileSync(join(incoming, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  process.stdout.write(JSON.stringify({ pluginCommit: sha, entries, nodeModulesSha256, resolved, peers }))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

// v2 必须是完整新格式：任一段缺失/类型错误都返回问题列表，绝不被解释成 legacy。
function v2Problems(meta) {
  const problems = []
  if (!isObject(meta.entries)) {
    problems.push('missing entries')
  } else {
    for (const name of entryFiles()) {
      if (!isSha256(meta.entries[name])) problems.push(`invalid entries.${name}`)
    }
    if (typeof meta.entrySha256 !== 'string' || meta.entrySha256 !== meta.entries.index) problems.push('entrySha256 does not match entries.index')
  }
  if (!isObject(meta.dependencies)) {
    problems.push('missing dependencies')
  } else {
    if (!isSha256(meta.dependencies.lockfileSha256)) problems.push('invalid dependencies.lockfileSha256')
    // F2: a complete meta must carry the dependency-tree hash; null/absent can no longer be
    // used to skip the tree comparison.
    if (!isSha256(meta.dependencies.nodeModulesSha256)) problems.push('invalid dependencies.nodeModulesSha256 (a complete release must record the dependency-tree hash)')
    if (!isObject(meta.dependencies.resolved)) problems.push('missing dependencies.resolved')
    if (!isObject(meta.dependencies.peers)) problems.push('missing dependencies.peers')
    if (!Array.isArray(meta.dependencies.peersReplaced)) problems.push('missing dependencies.peersReplaced')
  }
  if (!isObject(meta.activation) || meta.activation.markerVersion !== 1 || !Array.isArray(meta.activation.entries) || meta.activation.entries.length === 0) {
    problems.push('missing activation metadata')
  } else {
    for (const name of entryFiles()) {
      if (!meta.activation.entries.includes(name)) problems.push(`activation metadata does not cover the ${name} entry`)
    }
  }
  return problems
}

// 历史 formatVersion:1 有两种合法形态（都只在显式回滚/恢复授权下允许）：
// - complete：三段齐全（旧 prepare 的实际产物），仍按完整字段校验并要求双入口激活；
// - pure：三段全无的纯历史 legacy，只按历史 entrySha256 校验；
// 部分段残缺 = 降级/混合格式，一律拒绝。
const LEGACY_SECTIONS = ['entries', 'dependencies', 'activation']
function legacyShape(meta) {
  const present = LEGACY_SECTIONS.filter((field) => meta[field] !== undefined)
  if (present.length === 0) return 'pure'
  if (present.length === LEGACY_SECTIONS.length) return 'complete'
  return 'partial'
}

// 纯历史 legacy 只允许历史字段；出现任何新格式字段即视为混合格式。
function pureLegacyProblems(meta) {
  const problems = []
  for (const field of LEGACY_SECTIONS) {
    if (meta[field] !== undefined) problems.push(`unexpected ${field} in pure legacy meta`)
  }
  if (!isSha256(meta.entrySha256)) problems.push('invalid entrySha256')
  return problems
}

function legacyEntryValid(meta, dir) {
  const file = join(dir, 'lib', 'index.mjs')
  return existsSync(file) && sha256File(file) === meta.entrySha256
}

// 完整 meta（v2 或三段齐全的历史 v1）的入口/依赖校验。
function verifyCompleteMeta(meta, dir) {
  for (const name of entryFiles()) {
    const file = join(dir, 'lib', `${name}.mjs`)
    if (!existsSync(file)) fail(`release entry missing: ${file}`)
    if (sha256File(file) !== meta.entries[name]) fail(`entry hash mismatch: ${file}`)
  }
  const deps = meta.dependencies
  const lockfile = join(dir, 'pnpm-lock.yaml')
  if (!existsSync(lockfile)) fail(`release dependency record is missing pnpm-lock.yaml: ${lockfile}`)
  if (sha256File(lockfile) !== deps.lockfileSha256) fail(`release lockfile hash mismatch: ${lockfile}`)
  if (deps.nodeModulesSha256 !== null) {
    const actual = treeHash(join(dir, 'node_modules'))
    if (actual !== deps.nodeModulesSha256) fail(`release dependency tree hash mismatch: ${join(dir, 'node_modules')}`)
  }
  // F2: cross-check the dependency metadata against the release's own package.json. A
  // truncated/partial `resolved`/`peers` map must not be able to hide a packaged dependency
  // or peer, and extra entries not declared by package.json are equally suspicious.
  const packageJsonFile = join(dir, 'package.json')
  if (!existsSync(packageJsonFile)) fail(`release package.json is missing: ${packageJsonFile}`)
  const packaged = readJson(packageJsonFile)
  const declaredDependencies = Object.keys(packaged.dependencies ?? {}).sort()
  const recordedDependencies = Object.keys(deps.resolved).sort()
  for (const name of declaredDependencies) {
    if (!Object.prototype.hasOwnProperty.call(deps.resolved, name)) {
      fail(`release meta is missing the resolved entry for declared dependency: ${name}`)
    }
  }
  for (const name of recordedDependencies) {
    if (!declaredDependencies.includes(name)) {
      fail(`release meta records a resolved dependency that package.json does not declare: ${name}`)
    }
  }
  const declaredPeers = Object.keys(packaged.peerDependencies ?? {}).sort()
  const recordedPeers = Object.keys(deps.peers).sort()
  for (const name of declaredPeers) {
    if (!Object.prototype.hasOwnProperty.call(deps.peers, name)) {
      fail(`release meta is missing the peer entry for declared peerDependency: ${name}`)
    }
  }
  for (const name of recordedPeers) {
    if (!declaredPeers.includes(name)) {
      fail(`release meta records a peer that package.json does not declare: ${name}`)
    }
  }
  for (const [name, version] of Object.entries(deps.resolved)) {
    const file = join(dir, 'node_modules', name, 'package.json')
    if (!existsSync(file)) fail(`release is missing production dependency: ${name}`)
    const actual = readJson(file).version ?? null
    if (actual !== version) fail(`release production dependency version mismatch: ${name} ${String(actual)} vs ${String(version)}`)
  }
  for (const [name, target] of Object.entries(deps.peers)) {
    if (target === 'optional-missing') continue
    if (!existsSync(join(dir, 'node_modules', name))) fail(`release is missing the explicit peer link: ${name}`)
    if (!existsSync(join(target, 'package.json'))) fail(`peer target is unavailable on this host: ${name} -> ${target}`)
  }
}

function check(options) {
  const dir = resolve(options.release)
  const metaFile = join(dir, 'meta.json')
  if (!existsSync(metaFile)) fail(`release meta missing: ${metaFile}`)
  const meta = readJson(metaFile)
  const allowLegacy = options['allow-legacy-rollback'] === true
  const expected = options.sha
  if (expected !== undefined && shaOf(expected, '--sha') !== meta.pluginCommit) {
    fail(`release meta pluginCommit does not match directory: ${meta.pluginCommit} vs ${expected}`)
  }
  if (typeof meta.hostVersion !== 'string' || meta.hostVersion.trim() === '') fail('release meta is missing hostVersion')
  if (!existsSync(join(dir, 'lib', 'index.mjs'))) fail(`release lib missing: ${join(dir, 'lib', 'index.mjs')}`)

  if (meta.formatVersion === META_FORMAT_VERSION) {
    const problems = v2Problems(meta)
    if (problems.length > 0) fail(`release meta v2 is incomplete: ${problems.join('; ')}`)
    verifyCompleteMeta(meta, dir)
  } else if (meta.formatVersion === LEGACY_FORMAT_VERSION) {
    // 历史 v1 兼容只在显式回滚/恢复上下文允许；正向部署绝不接受任何 v1。
    if (!allowLegacy) fail('legacy release meta (formatVersion:1) is only accepted for explicit rollback/restore; pass --allow-legacy-rollback')
    const shape = legacyShape(meta)
    if (shape === 'partial') fail('legacy release meta is partially upgraded (only some of entries/dependencies/activation); refusing the mixed format')
    if (shape === 'complete') {
      // 旧 prepare 的实际产物：formatVersion:1 但三段齐全；按完整字段校验，activation 仍要求双入口。
      const problems = v2Problems(meta)
      if (problems.length > 0) fail(`legacy release meta v1 is incomplete: ${problems.join('; ')}`)
      verifyCompleteMeta(meta, dir)
    } else {
      const problems = pureLegacyProblems(meta)
      if (problems.length > 0) fail(`pure legacy release meta is invalid: ${problems.join('; ')}`)
      if (!legacyEntryValid(meta, dir)) fail(`entry hash mismatch: ${dir}`)
    }
  } else {
    fail(`unsupported release meta format: ${String(meta.formatVersion)}`)
  }
  // F3: peer links in the meta are recorded as absolute --peer-root targets and their
  // readlink strings are inside the dependency-tree hash, so a host peer-root move/reinstall
  // invalidates this release's `check` (fail-closed, but it blocks rollback). Surface the
  // prerequisite explicitly instead of leaving it implicit.
  const peerNames = isObject(meta.dependencies?.peers) ? Object.keys(meta.dependencies.peers) : []
  const warnings = peerNames.length > 0
    ? [`this release links ${peerNames.length} peer package(s) through absolute --peer-root paths; keep the host peer root path and versions stable, or rebuild the release before rollback (moving/reinstalling the peer root makes this release fail check)`]
    : []
  for (const warning of warnings) console.error(`warning: ${warning}`)
  process.stdout.write(JSON.stringify({ ok: true, pluginCommit: meta.pluginCommit, formatVersion: meta.formatVersion, activation: meta.activation ?? null, peerRootStability: peerNames.length > 0 ? 'required' : 'not-applicable', warnings }))
}

function activation(options) {
  const dir = resolve(options.release)
  const metaFile = join(dir, 'meta.json')
  if (!existsSync(metaFile)) {
    process.stdout.write('none')
    return
  }
  const meta = readJson(metaFile)
  const allowLegacy = options['allow-legacy-rollback'] === true
  if (meta.formatVersion === META_FORMAT_VERSION) {
    // 与 check 保持一致：v2 缺任何必需段都不是 legacy，而是 invalid。
    if (v2Problems(meta).length > 0) {
      process.stdout.write('invalid')
      return
    }
    process.stdout.write(`required:${meta.activation.entries.join(',')}`)
    return
  }
  if (meta.formatVersion === LEGACY_FORMAT_VERSION) {
    if (!allowLegacy) {
      process.stdout.write('invalid')
      return
    }
    const shape = legacyShape(meta)
    if (shape === 'complete') {
      // 三段齐全的历史 v1（旧 prepare 产物）与 v2 一样要求 required 双入口激活。
      if (v2Problems(meta).length > 0) {
        process.stdout.write('invalid')
        return
      }
      process.stdout.write(`required:${meta.activation.entries.join(',')}`)
      return
    }
    if (shape === 'partial') {
      process.stdout.write('invalid')
      return
    }
    // 纯历史 v1：历史哈希仍须与文件一致；损坏的 legacy 不允许 health-only。
    if (pureLegacyProblems(meta).length > 0 || !legacyEntryValid(meta, dir)) {
      process.stdout.write('invalid')
      return
    }
    process.stdout.write('legacy')
    return
  }
  // 未知版本（含缺失/类型错误）：既不是可验证新格式，也不是获授权的历史 legacy。
  process.stdout.write('invalid')
}

const [command, ...rest] = process.argv.slice(2)
const options = args(rest)
if (command === 'prepare') prepare(options)
else if (command === 'check') check(options)
else if (command === 'activation') activation(options)
else if (command === 'tree-hash') {
  if (!options.dir) fail('tree-hash requires --dir')
  process.stdout.write(String(treeHash(resolve(options.dir))))
} else fail(`unknown command: ${String(command)}`)
