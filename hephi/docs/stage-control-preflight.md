# 阶段控制实施前核查

> 历史核查记录：后续用户已确认保留原 Worker 的最终 push／PR 流程，并在 ready 前核对最后检查点。因此下述交付接线阻断已解除，不再新增交付适配器。当前实现与限制见 stage-control.md。

日期：2026-11-03；源码基线 de990a6；分支 codex/stage-control。

## 当前结果

尚未实现阶段控制，也未部署。真实端到端未验证通过。
执行批准方案的前置检查时，发现“现有交付能力可直接复用”的前提不成立。按方案第 8 节“若必须新造交付链，先停止扩大实现，报告缺口”停止产品代码修改。

## 已核查的接口

- worker-mount.ts 已有 agent 作用域的 tools/pre-execute、tools.guard 和 systemPrompt 接点。
- 安装的 DSH rc.5 dsh-tools README 明确：作用域注册的工具不被继承工具 allow mask 隐藏；可尝试将阶段工具直接注册到 Worker 作用域，无需修改 Super Agent WORK_TOOLS。尚未做真实挂载测试。
- DSH 提供 tools/execute 包装和 tools/result 冻结结果观察接口；可用于跟踪调用和 progress。尚未验证后台进程生命周期与终止保证。
- 源仓库开发依赖仍是 alpha.2，而当前运行实例为 rc.5；实现必须针对真实宿主接口核对，不能用旧类型检查替代运行兼容性验证。

## 交付阻断依据

1. src/tools/prepare-delivery.ts:42 使用 branchName 生成 hephi/... 分支，不接收原 Worker 当前分支。
2. src/delivery/reconcile.ts:5-35 只创建/查找 PR 和 Issue 评论，没有 push。
3. src/delivery/gh-cli.ts 只有 GitHub API，没有工作区 Git 推送能力。
4. src/delivery/github-pr.ts 只返回已有 PR 或新建，不更新已有 PR；没有本地 HEAD/远端 HEAD 对账。
5. src/tools.ts 明确将旧 delivery helper 标为 legacy/manual，Worker 应使用原生 GitHub 流程。

因此不能直接把旧 helper 接到最后 finish 并声称可以完成当前分支交付。关闭全部 shell 后，现有 Worker 的 git push / gh pr 通路也会被关闭。

## 最小待定补充（尚未实施）

若继续保持最终修改锁，需要新增一个范围受限的交付适配函数，而非启用旧 Delivery 流程：读取当前分支与合同仓库、检查 clean/HEAD；以 execFile 固定参数推送当前 HEAD（不 force、不生成新分支）；查询/创建或更新同一 PR；失败后对账再重试；核对远端 HEAD；不发送 Issue 评论、不合并。

这是此前方案要求发现后先报告的新增交付接线，并非现成能力。不得用临时开放任意 bash、shell 字符串前缀匹配或静默切到旧 hephi 分支掩盖缺口。

## 本次变更与验证

仅增加本核查记录。未修改 Skill、阶段运行逻辑、宿主配置或 Super Agent；未重启服务，未新建任务。
文档变更只做 git diff --check，不运行无关构建测试，不宣称控制面或真实交付已通过。
