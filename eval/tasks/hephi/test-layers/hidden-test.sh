#!/bin/sh
set -eu
node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync('hephi/package.json', 'utf8'))
const scripts = pkg.scripts ?? {}
for (const name of ['test:unit', 'test:integration']) {
  if (typeof scripts[name] !== 'string' || scripts[name].length === 0) throw new Error(`missing script ${name}`)
}
if (scripts['test:unit'] === scripts['test:integration']) throw new Error('unit and integration scripts must differ')
if (!scripts['test:unit'].includes('vitest run')) throw new Error('test:unit must run vitest')
if (!scripts['test:integration'].includes('vitest run')) throw new Error('test:integration must run vitest')
if (!scripts['test:integration'].includes('--exclude')) throw new Error('integration must exclude unit-only suites')
if (scripts['test:unit'].includes('tests/probes')) throw new Error('unit must not include probe suites')
if (!String(scripts.check ?? '').includes('pnpm test')) throw new Error('check must still run the full test command')
console.log('PASS: package.json unit/integration test split')
JS
