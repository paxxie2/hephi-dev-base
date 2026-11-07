#!/usr/bin/env node
// Query the Super Agent `effect` table without writing the database (ROADMAP-95 H7 / §4.5).
//
// Usage:
//   node check-effects-db.mjs --db <path> [--mode ro|copy] [--json]
//
// Modes:
//   ro   (default) Open the database read-only and read committed WAL content.
//        It first tries the SQLite URI `file:///abs/path?mode=ro`; if the driver
//        rejects that form it falls back to `new DatabaseSync(path, {readOnly:true})`.
//        A read-only connection still sees rows that are committed in the -wal file
//        but not yet checkpointed into the main database file. Note: opening a WAL
//        database whose -wal/-shm were removed (e.g. right after a clean shutdown)
//        makes SQLite recreate an empty -wal and a -shm beside the database, so the
//        directory must be writable and the live directory gains two sidecar files.
//        `createdSidecars` in the JSON output reports exactly what was created.
//   copy Copy the database plus its -wal/-shm sidecars (when present) into a fresh
//        temp directory and query the copy. This is the §4.5 fallback for the
//        "host stopped, may have left WAL/shm" case: a read-only WAL open can fail
//        when a -shm file is missing, and a throwaway copy can safely be opened
//        read-write so SQLite may recover/replay the WAL inside the copy. Use copy
//        when the state directory must stay byte/entry untouched or is not writable.
//
// NEVER use `immutable=1`: the SQLite URI documentation says immutable tells SQLite
// the file cannot change and that it may skip locking/change detection; with a WAL
// database it ignores the -wal file and silently reads a stale, pre-checkpoint
// snapshot. That would under-report effect rows and could make a drain check pass
// on incomplete data. This tool never passes immutable=1.
//
// Read-only guarantee: `ro` never writes the database or its sidecars. `copy` only
// writes inside its own temp directory and removes it before exiting.
//
// Output: exactly one JSON object on stdout (parse stdout only; Node 22.19 prints an
// ExperimentalWarning for node:sqlite on stderr). Exit codes: 0 = ok, 1 = open or
// query failure, 2 = invalid usage. On failure the object is {ok:false,error,...}.
//
// Requires Node >= 22.19 with the built-in node:sqlite (DatabaseSync).
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const USAGE = 'usage: node check-effects-db.mjs --db <path> [--mode ro|copy] [--json]'
const QUERY = 'SELECT kind, count(*) AS count FROM effect GROUP BY kind ORDER BY kind'

function fail(message, extra = {}) {
  return { ok: false, error: message, ...extra }
}

function parseArgs(argv) {
  const options = { db: '', mode: 'ro', json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg !== '--db' && arg !== '--mode') return { error: `unknown argument: ${arg}` }
    const value = argv[index + 1]
    if (value === undefined) return { error: `missing value for ${arg}` }
    index += 1
    if (arg === '--db') options.db = value
    else options.mode = value
  }
  if (!options.db) return { error: '--db is required' }
  if (options.mode !== 'ro' && options.mode !== 'copy') return { error: `--mode must be ro or copy, got "${options.mode}"` }
  return options
}

function journalModeOf(db) {
  try {
    const row = db.prepare('PRAGMA journal_mode').get()
    const value = row && row.journal_mode
    return typeof value === 'string' ? value : 'unknown'
  } catch {
    return 'unknown'
  }
}

function readEffects(db, extra) {
  const rows = db.prepare(QUERY).all().map(row => ({ kind: String(row.kind), count: Number(row.count) }))
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  return { ok: true, ...extra, journalMode: journalModeOf(db), rows, total }
}

/**
 * Try the documented read-only URI first, then the driver's readOnly option.
 * Both must never create or write the database.
 */
function openReadOnly(absolute) {
  const attempts = []
  const uri = `${pathToFileURL(absolute).href}?mode=ro`
  try {
    return { db: new DatabaseSync(uri), open: 'uri' }
  } catch (error) {
    attempts.push(`uri: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    return { db: new DatabaseSync(absolute, { readOnly: true }), open: 'readOnly' }
  } catch (error) {
    attempts.push(`readOnly: ${error instanceof Error ? error.message : String(error)}`)
  }
  throw new Error(`cannot open database read-only (${attempts.join('; ')})`)
}

async function sidecars(absolute) {
  const files = [{ source: absolute, name: basename(absolute) }]
  for (const suffix of ['-wal', '-shm']) {
    const path = `${absolute}${suffix}`
    if (existsSync(path)) files.push({ source: path, name: `${basename(absolute)}${suffix}` })
  }
  return files
}

async function readOnly(dbPath) {
  const absolute = resolve(dbPath)
  // SQLite creates the WAL sidecars (-wal/-shm) on open when they are missing, even
  // for a read-only database connection: a WAL database needs its -shm shared-memory
  // file to read. That needs a writable directory (a truly read-only directory fails
  // with "attempt to write a readonly database"), so report what was created and let
  // the caller prefer `--mode copy` when the live directory must stay untouched.
  const sidecarsBefore = {
    wal: existsSync(`${absolute}-wal`),
    shm: existsSync(`${absolute}-shm`),
  }
  const opened = openReadOnly(absolute)
  const db = opened.db
  let result
  try {
    // A read-only WAL connection may briefly hit a checkpoint; fail fast instead of hanging.
    try { db.exec('PRAGMA busy_timeout=5000') } catch { /* not available on some builds */ }
    result = readEffects(db, { mode: 'ro', db: absolute, open: opened.open })
  } finally {
    try { db.close() } catch { /* already closed */ }
  }
  const sidecarsAfter = {
    wal: existsSync(`${absolute}-wal`),
    shm: existsSync(`${absolute}-shm`),
  }
  const createdSidecars = []
  if (!sidecarsBefore.wal && sidecarsAfter.wal) createdSidecars.push(`${basename(absolute)}-wal`)
  if (!sidecarsBefore.shm && sidecarsAfter.shm) createdSidecars.push(`${basename(absolute)}-shm`)
  return { ...result, sidecarsBefore, createdSidecars }
}

async function copyAndQuery(dbPath) {
  const absolute = resolve(dbPath)
  if (!existsSync(absolute)) throw new Error(`database not found: ${absolute}`)
  const directory = await mkdtemp(join(tmpdir(), 'hephi-effects-'))
  try {
    const files = await sidecars(absolute)
    const copiedFiles = []
    for (const file of files) {
      await copyFile(file.source, join(directory, file.name))
      copiedFiles.push(file.name)
    }
    const copiedPath = join(directory, basename(absolute))
    let db
    let copyOpen = 'rw'
    try {
      // The copy is disposable: read-write lets SQLite replay the copied WAL and
      // rebuild a missing -shm without ever touching the original database.
      db = new DatabaseSync(copiedPath)
    } catch {
      // A copied -shm can be stale relative to its new location; SQLite rebuilds it.
      await rm(`${copiedPath}-shm`, { force: true })
      db = new DatabaseSync(copiedPath)
      copyOpen = 'rw-rebuilt-shm'
    }
    try {
      return readEffects(db, {
        mode: 'copy', db: absolute, copiedFrom: absolute, copiedFiles, copyDir: directory, copyOpen,
      })
    } finally {
      try { db.close() } catch { /* already closed */ }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    console.log(USAGE)
    return 0
  }
  if (parsed.error) {
    console.log(JSON.stringify(fail(parsed.error)))
    process.stderr.write(`${parsed.error}\n${USAGE}\n`)
    return 2
  }
  try {
    const absolute = resolve(parsed.db)
    let result
    if (parsed.mode === 'copy') {
      result = await copyAndQuery(parsed.db)
    } else {
      const info = existsSync(absolute) ? await stat(absolute) : undefined
      if (!info) throw new Error(`database not found: ${absolute}`)
      result = await readOnly(parsed.db)
    }
    console.log(JSON.stringify(result))
    if (!parsed.json) {
      process.stderr.write(`effects: total=${result.total} journal=${result.journalMode} mode=${result.mode} rows=${JSON.stringify(result.rows)}\n`)
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result = fail(message, { mode: parsed.mode, db: resolve(parsed.db) })
    console.log(JSON.stringify(result))
    process.stderr.write(`effect query failed: ${message}\n`)
    return 1
  }
}

process.exitCode = await main(process.argv.slice(2))
