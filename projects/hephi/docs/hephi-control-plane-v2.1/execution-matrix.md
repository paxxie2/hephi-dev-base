# Execution Matrix

| Task | Owner | Depends on | Command | Outputs | Evidence | Acceptance |
|---|---|---|---|---|---|---|
| T0 基线 | codex | — | `git rev-parse HEAD && pnpm check` | baseline 记录 | 当前 commit、check 输出 | 基线可复现，工作树干净 |
| T1 Skill/工具对齐 | codex | T0 | `rg -n 'hephi_verify|hephi_kb_search' skills src` | Skill、工具 schema | diff、静态检查 | Skill 不再要求旧 helper |
| T2 workspace 共享 | codex | T0 | `pnpm typecheck` | `src/control/workspace.ts` | typecheck、单测 | KB 和 verifier 解析同一 checkout |
| T3 reverse 判定 | codex | T0 | `pnpm vitest run tests/verification/runner.test.ts` | runner、测试 | 判定矩阵输出 | 混合失败路径全部正确 |
| T4 baseMap | codex | T1,T2 | `pnpm vitest run tests/kb/index.test.ts` | KB、工具、测试 | JSON 断言 | baseSha 绑定、上限和截断生效 |
| T5 evidence | codex | T3,T4 | `pnpm vitest run tests/control/dubbo-verifier.test.ts` | evidence 字段 | evidence JSON | 命令、参数、报告 ID 可复核 |
| T6 E2E | codex | T1-T5 | `pnpm check`; `planned: dsh-superagent Ticket` | 真实证据 | check 与 Ticket evidence | 一个真实 Issue 通过 HEPHI ready gate |
