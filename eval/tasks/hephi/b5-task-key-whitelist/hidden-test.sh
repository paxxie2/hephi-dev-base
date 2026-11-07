#!/bin/sh
set -eu
node --input-type=module <<'JSTEST'
import assert from 'node:assert/strict';
import {validateTasks, UsageError} from './eval/b5-plan.mjs';
const task = {taskId:'fixture-task',repo:'fixture-repo',category:'defect-fix'};
assert.deepEqual(validateTasks([task]), [task]);
assert.deepEqual(validateTasks({tasks:[task]}), [task]);
for (const key of ['extra','environmentReady','categoryTypo']) {
  assert.throws(() => validateTasks([{...task,[key]:true}]), UsageError, `unknown key ${key} must be rejected`);
}
assert.throws(() => validateTasks([{...task,category:'invalid'}]), UsageError);
assert.throws(() => validateTasks([task,task]), UsageError);
console.log('B5 task key boundary checks PASS');
JSTEST
