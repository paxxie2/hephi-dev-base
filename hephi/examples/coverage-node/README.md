# C2 覆盖提示示例（Node）

状态：**示例 · 未集成进赫菲**。本目录是项目侧覆盖率提示脚本的最小示例，不是插件功能。
赫菲不解析覆盖率；该脚本的输出只作为**风险提示**，默认不拦截交付，是否作为必需检查由项目决定。

> 边界（C2）：被执行到 ≠ 有断言，也不等于改动必要；无关重构同样可能被完全覆盖。
> 因此“未被覆盖改动提示”只回答“这些可执行改动没被测试执行到”，不承担防止无关重构的职责。

## 文件

```
coverage-node/
├── coverage-hint.mjs        # 示例脚本（Node 内置模块，无依赖）
├── fixtures/
│   ├── coverage-final.json  # istanbul/nyc 风格的覆盖率输入（合成）
│   └── change.diff          # 统一 diff 输入（合成）
└── README.md
```

## 用法

```sh
# 1) 项目先在测试里生成 istanbul/nyc coverage-final.json（例如 nyc / c8 --reporter=json）
# 2) 用 git diff 或预生成 diff 与覆盖率求交，输出提示 JSON
node hephi/examples/coverage-node/coverage-hint.mjs \
  --coverage coverage/coverage-final.json \
  --repo . --base <base-commit> --out coverage-hint.json

# 或离线输入一份 diff：
node hephi/examples/coverage-node/coverage-hint.mjs \
  --coverage hephi/examples/coverage-node/fixtures/coverage-final.json \
  --diff-file hephi/examples/coverage-node/fixtures/change.diff
```

`--source-root` 仅用于把覆盖率 JSON 里的绝对路径映射回仓库相对路径（默认仓库根）。

## 本仓库内的真实运行（合成 fixture）

```sh
node --check hephi/examples/coverage-node/coverage-hint.mjs
node hephi/examples/coverage-node/coverage-hint.mjs --self-test
node hephi/examples/coverage-node/coverage-hint.mjs \
  --coverage hephi/examples/coverage-node/fixtures/coverage-final.json \
  --diff-file hephi/examples/coverage-node/fixtures/change.diff
```

实测结果（2026-11-07）：`--self-test` 5 项 PASS、exit 0；合成 fixture 输出
`summary: {changedFiles: 4, uncoveredFiles: 2, uncoveredLines: 2}`，其中：

- `src/a.mjs` 改动第 3/4 行，第 3 行已覆盖、第 4 行未覆盖 → 报第 4 行；
- `src/b.mjs` 无覆盖率条目（代码文件）→ 改动行全部按提示报出，原因 `no coverage entry`；
- `src/c.mjs` 第 5 行已覆盖 → 不报；`README.md` 非代码文件 → 不进入覆盖率提示。

## 输出格式（与 `hephi/docs/project-config.md` §5 一致）

```json
{
  "schemaVersion": 1,
  "kind": "coverage-hint",
  "tool": { "name": "coverage-hint-node-example", "version": "0.1.0" },
  "generatedAt": "…",
  "baseSha": "…|null",
  "headSha": "…|null",
  "changedFiles": 4,
  "uncovered": [
    { "path": "src/a.mjs", "lines": [4], "reason": "statement not executed by tests" },
    { "path": "src/b.mjs", "lines": [2], "reason": "no coverage entry; executable status unknown" }
  ],
  "summary": { "changedFiles": 4, "uncoveredFiles": 2, "uncoveredLines": 2 }
}
```

- 路径均为仓库相对路径；不输出绝对路径或环境变量。
- `uncovered` 为空表示没有提示（**不表示**改动已充分验证）。
- 退出码：`0`=成功生成提示（无论是否有 uncovered）；`1`=输入格式错误；`2`=用法/环境错误。

## 集成建议（项目侧，非赫菲）

- 作为 CI 附件/PR 评论：把 JSON 摘要贴到 PR 描述或审查材料，供审查者参考；
- 作为可选检查：项目可写一个包装脚本，按团队策略在“未覆盖行数 > 阈值”时非零退出，
  再把它作为 `verification.checks` 里的普通检查（默认建议**仅提示**，先测误报率）；
- 不要把它当“测试有效性”证明，也不要让赫菲依赖覆盖率格式。

## 已知限制

- 仅解析 istanbul/nyc `coverage-final.json` 的 **statement** 覆盖；不解析分支/函数/条件覆盖。
- 没有覆盖率条目的代码文件无法判断可执行性，整段改动按提示处理（可能误报）；
  非代码文件（README/配置）被过滤，避免噪声。
- 转译/打包/压缩后的源码需要项目自行做 source map 映射；本示例不处理。
- `node --test --experimental-test-coverage` 的原生覆盖率格式不是本示例的输入；项目可先转换成
  istanbul JSON，或按项目工具链调整示例。
- 示例不读取或修改赫菲状态，不写仓库文件（除 `--out` 指定路径）。
