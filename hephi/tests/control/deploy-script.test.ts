import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
// hephi/tests/control/deploy-script.test.ts -> 仓库根
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const harness = `${repoRoot}scripts/host/test-deploy-hephi.mjs`

// R3 假宿主自动化测试入口：只用临时目录、假 start 脚本、假状态响应和临时 git 仓库。
// 真实宿主 A→B→A、实载 commit 回读属于 R3.7，人工执行，不在此处伪造。
describe('deploy-hephi.sh 假宿主契约（R3-T01..T17）', () => {
  it('全部场景通过', async () => {
    const { stdout } = await run(process.execPath, [harness], { timeout: 180_000, cwd: repoRoot })
    expect(stdout).toContain('PASS: 44 assertions (R3 fake-host suite)')
    expect(stdout).not.toMatch(/^FAIL /m)
  }, 180_000)
})
