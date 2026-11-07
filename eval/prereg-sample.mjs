#!/usr/bin/env node
// Planning aid only: paired Bernoulli Wald plug-in normal approximation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Peter J. Acklam's inverse-normal rational approximation (relative error approximately 1.15e-9).
function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new Error('normal quantile probability out of range');
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const e = [0.00778469570904146, 0.32246712907004, 2.445134137143,
    3.75440866190742];
  const poly = (xs, x) => xs.reduce((v, n) => v * x + n, 0);
  if (p < 0.02425 || p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(p < 0.02425 ? p : 1 - p));
    const value = poly(c, q) / (poly(e, q) * q + 1);
    return p < 0.02425 ? value : -value;
  }
  const q = p - 0.5;
  const r = q * q;
  return poly(a, r) * q / (poly(b, r) * r + 1);
}

function estimate(input) {
  const fields = ['pairs', 'successRateOff', 'successRateNative', 'discordantRate',
    'alpha', 'power', 'margin'];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('pilot must be a JSON object');
  }
  for (const key of fields) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) {
      throw new Error(`${key} must be a finite number`);
    }
  }
  const { pairs, successRateOff: off, successRateNative: native,
    discordantRate: q, alpha, power, margin } = input;
  if (!Number.isSafeInteger(pairs) || pairs < 2) throw new Error('pairs must be an integer >= 2');
  if (off < 0 || off > 1 || native < 0 || native > 1 || q < 0 || q > 1) {
    throw new Error('success and discordant rates must be in [0,1]');
  }
  const d = native - off;
  if (q < Math.abs(d) - 1e-12 || q > Math.min(off + native, 2 - off - native) + 1e-12) {
    throw new Error('discordantRate incompatible with paired marginal success rates');
  }
  if (!(alpha > 0 && alpha < 1)) throw new Error('alpha must be in (0,1)');
  if (!(power > 0.5 && power < 1)) throw new Error('power must be in (0.5,1)');
  if (!(margin > -1 && margin < 0)) throw new Error('margin must be a negative threshold in (-1,0)');
  if (!(d > margin)) throw new Error('native minus off must exceed margin');
  const variance = q - d * d;
  if (!(variance > 0)) throw new Error('pilot paired variance must be positive');
  const requiredPairs = Math.ceil(
    (normalQuantile(1 - alpha / 2) + normalQuantile(power)) ** 2
    * variance / (d - margin) ** 2,
  );
  if (!Number.isSafeInteger(requiredPairs) || requiredPairs < 1) {
    throw new Error('requiredPairs is not a representable positive safe integer');
  }
  return {
    method: 'paired-wald-normal-approximation',
    inputs: Object.fromEntries(fields.map(key => [key, input[key]])),
    requiredPairs,
    status: 'pending-approval',
    notes: [
      'd=successRateNative-successRateOff; q=discordantRate; variance=q-d*d; N=ceil((z(1-alpha/2)+z(power))^2*variance/(d-margin)^2).',
      'alpha is two-sided: alpha=0.05 uses the lower endpoint of a 95% confidence interval (one-sided tail 0.025). margin is a negative noninferiority threshold.',
      'pairs is the pilot pair count only, echoed without adding it to or imposing a floor on the planned formal sample size. Pilot observations are not formal experiment results.',
      'Plug-in asymptotic Wald planning approximation, not exact McNemar or score-test power. Ignores pilot estimation uncertainty; sparse discordance can make the approximation unreliable or anticonservative.',
      'Estimates only a single guardrail binary endpoint for independent paired tasks. This is not the PREREG section 6 primary-metric McNemar/bootstrap sample-size calculation, nor the approved sample size for the whole round, individual strata, or joint metrics. Does not establish bootstrap power or real end-to-end acceptance.',
      'All inputs and sample size remain pending approval; no preregistration value is locked or written. Nam (1997), https://pubmed.ncbi.nlm.nih.gov/9423257/, documents limitations of paired Wald methods.',
    ],
  };
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prereg-sample-'));
  const base = { pairs: 100, successRateOff: 0.8, successRateNative: 0.8,
    discordantRate: 0.2, alpha: 0.05, power: 0.8, margin: -0.05 };
  let passed = 0;
  const run = (input) => {
    const file = path.join(dir, 'pilot.json');
    fs.writeFileSync(file, JSON.stringify(input));
    return spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--pilot', file], { encoding: 'utf8' });
  };
  const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
  try {
    for (const [name, patch, expected] of [
      ['fixed independent normal reference', {}, 628],
      ['unequal paired rates', { successRateNative: 0.85, discordantRate: 0.15 }, 116],
      ['looser margin reduces sample', { margin: -0.1 }, 157],
      ['greater power increases sample', { power: 0.9 }, 841],
      ['two-sided alpha convention', { alpha: 0.1 }, 495],
    ]) test(name, () => {
      const input = { ...base, ...patch }; const result = run(input);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.requiredPairs, expected);
      assert.deepEqual(output.inputs, input);
      assert.equal(output.status, 'pending-approval');
    });
    test('pilot size does not lock or floor formal N', () => {
      assert.equal(JSON.parse(run({ ...base, pairs: 10000 }).stdout).requiredPairs, 628);
    });
    for (const [name, patch] of [
      ['missing field', { power: undefined }], ['string type', { alpha: '0.05' }],
      ['invalid pairs', { pairs: 1 }], ['discordance below difference', { successRateNative: 0.9, discordantRate: 0.01 }],
      ['discordance above joint bound', { discordantRate: 0.5 }],
      ['zero variance', { discordantRate: 0 }],
      ['alternative below margin', { successRateNative: 0.7 }],
      ['positive margin', { margin: 0.05 }], ['invalid alpha', { alpha: 0 }],
      ['invalid power', { power: 1 }], ['boolean type', { pairs: true }],
    ]) test(name, () => assert.equal(run({ ...base, ...patch }).status, 2));
    test('missing CLI arguments exit 2', () => {
      assert.equal(spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' }).status, 2);
    });
    test('malformed JSON exits 2', () => {
      const file = path.join(dir, 'invalid.json'); fs.writeFileSync(file, '{');
      assert.equal(spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--pilot', file], { encoding: 'utf8' }).status, 2);
    });
    console.log(`PASS ${passed} self-tests (synthetic numeric/CLI checks only; no real experiment or E2E validation)`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') selfTest();
  else if (args.length === 2 && args[0] === '--pilot') {
    console.log(JSON.stringify(estimate(JSON.parse(fs.readFileSync(args[1], 'utf8'))), null, 2));
  } else throw new Error('usage: node eval/prereg-sample.mjs --pilot <json-file> | --self-test');
} catch (error) {
  console.error(`prereg-sample: ${error.message}`);
  process.exitCode = 2;
}
