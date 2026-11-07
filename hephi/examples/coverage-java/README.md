# C2 覆盖提示示例（Java / JaCoCo）

状态：**示例 · 未集成进赫菲**。本目录是项目侧覆盖率提示脚本的最小示例，不是插件功能。
赫菲不解析覆盖率；该脚本输出只作为**风险提示**，默认不拦截交付，是否作为必需检查由项目决定。

> 边界（C2）：被执行到 ≠ 有断言，也不等于改动必要；无关重构也可能被完全覆盖。
> 本示例只解析 JaCoCo XML 的 `line` 行覆盖，不做语义判断，不负责防止无关重构。

## 文件

```
coverage-java/
├── coverage-hint-java.mjs   # 示例脚本（Node 内置模块 + 简单文本解析，无依赖）
├── fixtures/
│   ├── jacoco.xml           # JaCoCo XML 片段（合成）
│   └── change.diff          # 统一 diff（合成）
└── README.md
```

## 用法

```sh
# 1) 项目用 JaCoCo 生成 XML 报告（例如 mvn test jacoco:report → target/site/jacoco/jacoco.xml）
# 2) 与 git diff 求交，输出提示 JSON
node hephi/examples/coverage-java/coverage-hint-java.mjs \
  --report target/site/jacoco/jacoco.xml \
  --repo . --base <base-commit> --source-root src/main/java --out coverage-hint.json

# 或离线输入一份 diff：
node hephi/examples/coverage-java/coverage-hint-java.mjs \
  --report hephi/examples/coverage-java/fixtures/jacoco.xml \
  --diff-file hephi/examples/coverage-java/fixtures/change.diff
```

`--source-root` 与 JaCoCo 的 `<package name="com/example">`、`<sourcefile name="Calc.java">`
拼接成仓库相对路径 `src/main/java/com/example/Calc.java`（默认 `src/main/java`）。

## 本仓库内的真实运行（合成 fixture）

```sh
node --check hephi/examples/coverage-java/coverage-hint-java.mjs
node hephi/examples/coverage-java/coverage-hint-java.mjs --self-test
node hephi/examples/coverage-java/coverage-hint-java.mjs \
  --report hephi/examples/coverage-java/fixtures/jacoco.xml \
  --diff-file hephi/examples/coverage-java/fixtures/change.diff
```

实测结果（2026-11-07）：`--self-test` 4 项 PASS、exit 0；合成 fixture 输出
`summary: {changedFiles: 2, uncoveredFiles: 2, uncoveredLines: 2}`：

- `Calc.java` 改动第 3/4 行，第 3 行覆盖、第 4 行未覆盖 → 报第 4 行；
- `Other.java` 无报告条目 → 改动行全部按提示报出；
- `nr=5 mi=0 ci=0` 的行按不可执行处理，不报。

## 输出格式（与 `hephi/docs/project-config.md` §5 一致）

与 Node 示例相同：`{schemaVersion, kind:"coverage-hint", tool, generatedAt, baseSha, headSha,
changedFiles, uncovered:[{path, lines, reason}], summary}`；路径为仓库相对路径，
不输出绝对路径；退出码 `0`=生成成功（无论是否有提示）、`1`=输入格式错误、`2`=用法/环境错误。

## 集成建议（项目侧，非赫菲）

- 把 JSON 摘要附到 PR/审查材料，供审查者参考；
- 如需拦截，项目写包装脚本按团队阈值非零退出，再作为普通 `verification.checks` 项
  （建议先只提示，在开发集上测误报率与命中率）；
- 不要把它当“测试有效性”或“改动必要性”证明。

## 已知限制

- 仅解析 JaCoCo XML 的 `<line nr mi ci>` 行覆盖；不解析分支/方法覆盖、不解析 Kotlin 行映射；
- 示例用正则做文本解析（不是完整 XML 解析器），生产请用项目自己的 XML 工具；
- 多模块/多 source root、生成代码、Lombok 等可能需要每模块分别运行并合并；
- 没有报告条目的文件无法判断可执行性，整段改动按提示处理（可能误报）；
- 不写仓库文件（除 `--out`），不读取赫菲状态。
