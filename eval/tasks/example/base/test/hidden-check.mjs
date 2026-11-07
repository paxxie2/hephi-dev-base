// 合成示例夹具的隐藏验收测试（B2）：由 eval/tasks/example/hidden-test.sh 调用。
// base 版本应失败；参考修复（reference.patch）后应通过；必须可重复运行。
import { add, multiply } from '../src/calc.mjs'

const failures = []

if (add(2, 3) !== 5) failures.push(`add(2, 3) = ${add(2, 3)}，期望 5`)
if (add(-1, 1) !== 0) failures.push(`add(-1, 1) = ${add(-1, 1)}，期望 0`)
if (multiply(2, 3) !== 6) failures.push(`multiply(2, 3) = ${multiply(2, 3)}，期望 6`)

if (failures.length > 0) {
  console.error(`hidden-check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('hidden-check passed')
