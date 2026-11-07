#!/usr/bin/env node
// H7 probe: real WAL fixtures for scripts/host/check-effects-db.mjs (ROADMAP-95 §4.5).
//
// Verifies with real SQLite files (no mocks):
//   A. read-only mode sees rows committed in a live -wal file but not checkpointed;
//   B. `immutable=1` silently misses those WAL rows (never allowed in the tool);
//   C. the read-only query leaves the database and WAL byte-identical;
//   D. missing/corrupt databases fail with a JSON error and exit 1 (usage errors exit 2);
//   E. copy mode reads the same rows from a db+wal(+shm) copy and cleans its temp dir;
//   F. after a clean writer close (checkpoint, WAL removed) read-only mode still works.
//
// Uses Node >= 22.19 `node:sqlite` for the writer/immutable comparisons and the
// system `sqlite3` CLI (3.54.0 here) for the immutable=1 comparison in a second
// implementation. Run with the same Node binary the host uses:
//   node scripts/host/test-effects-db.mjs
// Prints PASS/FAIL lines and exits non-zero when an assertion fails. Temp dirs removed.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))
const tool = join(here, 'check-effects-db.mjs')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'hephi-h7-'))
const expectedRows = [
  { kind: 'baseline', count: 1 },
  { kind: 'completed', count: 1 },
  { kind: 'started', count: 2 },
]
const expectedTotal = 4

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`PASS ${name}`)
    return
  }
  failed += 1
  console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}
function messageOf(error) { return error instanceof Error ? error.message : String(error) }

function runTool(args) {
  const result = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 30_000 })
  const stdout = result.stdout ?? ''
  let json
  try { json = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1)) } catch { json = undefined }
  return { code: result.status, stdout, stderr: result.stderr ?? '', json }
}
function sqlite3(args) {
  const result = spawnSync('sqlite3', args, { encoding: 'utf8', timeout: 30_000 })
  return { code: result.status, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}
function snapshot(path) {
  if (!existsSync(path)) return null
  const info = statSync(path)
  return { size: info.size, mtimeMs: info.mtimeMs, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
}
function unchanged(before, after) {
  return Boolean(before && after) && before.size === after.size && before.mtimeMs === after.mtimeMs && before.sha256 === after.sha256
}
function sameRows(rows) { return JSON.stringify(rows) === JSON.stringify(expectedRows) }

/**
 * WAL fixture: one checkpointed row lives in the main database file, three more
 * rows are committed into the -wal file only (`wal_autocheckpoint=0`), and the
 * writer connection stays open so the WAL is never checkpointed/removed.
 */
function createFixture() {
  const dbPath = join(fixtureRoot, 'orchestrator.sqlite')
  const walPath = `${dbPath}-wal`, shmPath = `${dbPath}-shm`
  const writer = new DatabaseSync(dbPath)
  writer.exec('PRAGMA journal_mode=WAL')
  writer.exec('PRAGMA wal_autocheckpoint=0')
  writer.exec('CREATE TABLE effect(kind TEXT)')
  writer.exec("INSERT INTO effect VALUES ('baseline')")
  writer.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  writer.exec("INSERT INTO effect VALUES ('started'),('completed'),('started')")
  const count = writer.prepare('SELECT count(*) AS c FROM effect').get().c
  return { dbPath, walPath, shmPath, writer, count }
}

let writer
try {
  const fixture = createFixture()
  writer = fixture.writer
  const { dbPath, walPath, shmPath } = fixture

  // ---- fixture -------------------------------------------------------------
  check('H7-fixture wal file holds uncheckpointed rows', existsSync(walPath) && statSync(walPath).size > 0 && existsSync(shmPath), `wal=${existsSync(walPath)} shm=${existsSync(shmPath)}`)
  check('H7-fixture writer sees baseline + WAL rows', fixture.count === expectedTotal, `count=${fixture.count}`)

  // ---- A: read-only mode reads committed WAL content -----------------------
  const before = { db: snapshot(dbPath), wal: snapshot(walPath), shm: snapshot(shmPath) }
  const live = runTool(['--db', dbPath, '--mode', 'ro', '--json'])
  check('H7-A ro exits 0 on a live WAL database', live.code === 0, `code=${live.code} stderr=${live.stderr}`)
  check('H7-A ro reports ok/mode/journalMode', live.json?.ok === true && live.json.mode === 'ro' && live.json.journalMode === 'wal', JSON.stringify(live.json))
  check('H7-A ro reports the database path', live.json?.db === resolve(dbPath), String(live.json?.db))
  check('H7-A ro sees all rows committed in the WAL (total 4)', live.json?.total === expectedTotal, JSON.stringify(live.json))
  check('H7-A ro groups effect rows by kind', sameRows(live.json?.rows ?? []), JSON.stringify(live.json?.rows))
  check('H7-A ro opened through the read-only URI (or its documented fallback)', live.json?.open === 'uri' || live.json?.open === 'readOnly', String(live.json?.open))
  check('H7-A ro creates no sidecars when the live WAL files already exist', Array.isArray(live.json?.createdSidecars) && live.json.createdSidecars.length === 0, JSON.stringify(live.json?.createdSidecars))

  // ---- C: the read-only query did not write the database -------------------
  const after = { db: snapshot(dbPath), wal: snapshot(walPath), shm: snapshot(shmPath) }
  check('H7-C ro leaves the database file byte-identical', unchanged(before.db, after.db), JSON.stringify({ before: before.db, after: after.db }))
  check('H7-C ro leaves the WAL file byte-identical', unchanged(before.wal, after.wal), JSON.stringify({ before: before.wal, after: after.wal }))
  check('H7-C ro leaves the shm file size unchanged', before.shm?.size === after.shm?.size, JSON.stringify({ before: before.shm, after: after.shm }))

  // ---- B: immutable=1 misses the WAL rows ----------------------------------
  let nodeImmutable
  try {
    const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?immutable=1`)
    nodeImmutable = db.prepare('SELECT count(*) AS c FROM effect').get().c
    db.close()
  } catch (error) {
    nodeImmutable = `error: ${messageOf(error)}`
  }
  check('H7-B node:sqlite immutable=1 misses uncheckpointed WAL rows', nodeImmutable === 1, `immutable count=${nodeImmutable} ro count=${live.json?.total}`)
  const sqliteImmutable = sqlite3([`file:${dbPath}?immutable=1`, 'SELECT count(*) FROM effect;'])
  check('H7-B sqlite3 immutable=1 misses uncheckpointed WAL rows', sqliteImmutable.code === 0 && sqliteImmutable.out === '1', `code=${sqliteImmutable.code} out=${sqliteImmutable.out} err=${sqliteImmutable.err}`)
  const sqliteRo = sqlite3([`file:${dbPath}?mode=ro`, 'SELECT count(*) FROM effect;'])
  check('H7-B sqlite3 file:...?mode=ro sees the WAL rows', sqliteRo.code === 0 && sqliteRo.out === String(expectedTotal), `code=${sqliteRo.code} out=${sqliteRo.out} err=${sqliteRo.err}`)
  const sqliteReadonly = sqlite3(['-readonly', dbPath, 'SELECT count(*) FROM effect;'])
  check('H7-B sqlite3 -readonly sees the WAL rows', sqliteReadonly.code === 0 && sqliteReadonly.out === String(expectedTotal), `code=${sqliteReadonly.code} out=${sqliteReadonly.out} err=${sqliteReadonly.err}`)
  const source = readFileSync(tool, 'utf8').split('\n')
  const immutableLines = source.filter(line => line.includes('immutable'))
  check('H7-B tool mentions immutable=1 only in comments (never as code)', immutableLines.length > 0 && immutableLines.every(line => /^\s*(\/\/|\*|\/\*)/.test(line)), immutableLines.join(' | '))

  // ---- D: missing / corrupt databases fail closed --------------------------
  const missingPath = join(fixtureRoot, 'missing.sqlite')
  const missing = runTool(['--db', missingPath, '--mode', 'ro', '--json'])
  check('H7-D missing database exits 1 with a JSON error', missing.code === 1 && missing.json?.ok === false && typeof missing.json?.error === 'string', `code=${missing.code} out=${missing.stdout}`)
  check('H7-D missing database is not created', !existsSync(missingPath))
  const corruptPath = join(fixtureRoot, 'corrupt.sqlite')
  writeFileSync(corruptPath, 'this is not a sqlite database\n')
  const corruptBefore = snapshot(corruptPath)
  const corrupt = runTool(['--db', corruptPath, '--mode', 'ro', '--json'])
  check('H7-D corrupt database exits 1 with a JSON error', corrupt.code === 1 && corrupt.json?.ok === false && typeof corrupt.json?.error === 'string', `code=${corrupt.code} out=${corrupt.stdout}`)
  check('H7-D corrupt database is left unchanged', unchanged(corruptBefore, snapshot(corruptPath)))
  const usage = runTool([])
  check('H7-D invalid usage exits 2 with a JSON error', usage.code === 2 && usage.json?.ok === false, `code=${usage.code} out=${usage.stdout}`)
  const help = runTool(['--help'])
  check('H7-D --help exits 0 and prints usage', help.code === 0 && help.stdout.includes('usage: node check-effects-db.mjs'), `code=${help.code}`)

  // ---- E: copy fallback reads the same WAL rows ----------------------------
  const copyBefore = { db: snapshot(dbPath), wal: snapshot(walPath) }
  const copied = runTool(['--db', dbPath, '--mode', 'copy', '--json'])
  check('H7-E copy mode exits 0', copied.code === 0, `code=${copied.code} stderr=${copied.stderr}`)
  check('H7-E copy mode reports its source database', copied.json?.mode === 'copy' && copied.json?.copiedFrom === resolve(dbPath), JSON.stringify(copied.json))
  check('H7-E copy mode reads the same rows as read-only mode', copied.json?.total === expectedTotal && sameRows(copied.json?.rows ?? []), JSON.stringify(copied.json?.rows))
  const copiedNames = copied.json?.copiedFiles ?? []
  const expectedNames = [basename(dbPath), `${basename(dbPath)}-wal`, `${basename(dbPath)}-shm`]
  check('H7-E copy mode copies db, -wal and -shm', expectedNames.every(name => copiedNames.includes(name)) && copiedNames.length === expectedNames.length, JSON.stringify(copiedNames))
  check('H7-E copy mode leaves the original db and WAL untouched', unchanged(copyBefore.db, snapshot(dbPath)) && unchanged(copyBefore.wal, snapshot(walPath)))
  check('H7-E copy mode removes its temp directory', typeof copied.json?.copyDir === 'string' && !existsSync(copied.json.copyDir), String(copied.json?.copyDir))

  // ---- F: clean writer close checkpoints the WAL; read-only still works ----
  writer.close()
  writer = undefined
  check('H7-F clean close checkpoints and removes -wal/-shm', !existsSync(walPath) && !existsSync(shmPath), `wal=${existsSync(walPath)} shm=${existsSync(shmPath)}`)
  // P0-3 evidence: the system sqlite3 CLI cannot open a WAL database read-only once
  // the -shm/-wal sidecars are gone (it will not create them; this build has no -uri
  // option either). That is exactly why the Node driver + copy fallback matter.
  const cliReadonlyClean = sqlite3(['-readonly', dbPath, 'SELECT count(*) FROM effect;'])
  check('H7-F sqlite3 -readonly fails after clean shutdown without -shm (documented risk)', cliReadonlyClean.code !== 0 && /unable to open/.test(cliReadonlyClean.err), `code=${cliReadonlyClean.code} err=${cliReadonlyClean.err}`)
  const cliRoClean = sqlite3([`file:${dbPath}?mode=ro`, 'SELECT count(*) FROM effect;'])
  check('H7-F sqlite3 file:...?mode=ro fails after clean shutdown without -shm (documented risk)', cliRoClean.code !== 0 && /unable to open/.test(cliRoClean.err), `code=${cliRoClean.code} err=${cliRoClean.err}`)
  const shutdownBefore = snapshot(dbPath)
  const shutdown = runTool(['--db', dbPath, '--mode', 'ro', '--json'])
  check('H7-F post-shutdown ro exits 0 and sees all 4 rows', shutdown.code === 0 && shutdown.json?.total === expectedTotal, `code=${shutdown.code} ${shutdown.stdout}`)
  check('H7-F post-shutdown ro keeps journalMode wal', shutdown.json?.journalMode === 'wal', String(shutdown.json?.journalMode))
  check('H7-F post-shutdown ro leaves the database unchanged', unchanged(shutdownBefore, snapshot(dbPath)))
  const recreated = shutdown.json?.createdSidecars ?? []
  check('H7-F post-shutdown ro reports the recreated WAL sidecars', recreated.includes(`${basename(dbPath)}-wal`) && recreated.includes(`${basename(dbPath)}-shm`), JSON.stringify(recreated))
  check('H7-F recreated WAL file is empty (no database content written)', existsSync(walPath) && statSync(walPath).size === 0, `walSize=${existsSync(walPath) ? statSync(walPath).size : 'missing'}`)

  // ---- G: sidecar creation needs a writable directory; copy is the fallback ----
  rmSync(walPath, { force: true })
  rmSync(shmPath, { force: true })
  const readOnlyBefore = snapshot(dbPath)
  chmodSync(fixtureRoot, 0o555)
  let denied
  let copiedFallback
  try {
    denied = runTool(['--db', dbPath, '--mode', 'ro', '--json'])
    copiedFallback = runTool(['--db', dbPath, '--mode', 'copy', '--json'])
  } finally {
    chmodSync(fixtureRoot, 0o755)
  }
  check('H7-G ro fails when the state directory cannot hold the WAL sidecars', denied.code === 1 && denied.json?.ok === false, `code=${denied.code} out=${denied.stdout}`)
  check('H7-G failed ro did not create sidecars in the read-only directory', !existsSync(walPath) && !existsSync(shmPath), `wal=${existsSync(walPath)} shm=${existsSync(shmPath)}`)
  check('H7-G copy fallback succeeds in a read-only directory', copiedFallback.code === 0 && copiedFallback.json?.total === expectedTotal, `code=${copiedFallback.code} out=${copiedFallback.stdout}`)
  check('H7-G copy fallback leaves the original database unchanged', unchanged(readOnlyBefore, snapshot(dbPath)))
} finally {
  try { writer?.close() } catch { /* already closed */ }
  rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed (H7 effects-db probe)`)
if (failed > 0) process.exitCode = 1
