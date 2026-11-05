# Rollback Plan

## R0：代码批次回退

回退到基线：

```text
bd53f06eaf9dd6dd412523970eb7e7f0a184bcb6
```

只回退本批 HEPHI 插件提交，不触碰 Super Agent 数据、Ticket、Worker Session 或 GitHub PR。

## R1：先关闭 Worker 辅助入口

如果 Skill 或旧 `hephi_verify` 仍造成误导：

- 保留 ready gate；
- 移除旧 helper 的 Worker 必做要求；
- 必要时从 Worker 工具可见列表中隐藏该工具；
- 不回退确定性 ready 验证。

## R2：baseMap 降级

如果 baseMap 生成失败、耗时异常或结果不可信：

- 保留 `hephi_kb_search` 的历史引用返回；
- 将 baseMap 标记为 unavailable/unknown；
- 不使用 patched workspace 推断当前代码事实；
- ready gate 仍按现有合同和验证结果工作。

## 不允许的回退方式

- 不因 KB 或 baseMap 失败而绕过 ready gate；
- 不把旧同 workspace reverse 恢复成交付验证；
- 不删除 activation.intent；
- 不让激活任务退回普通 Worker 流程。
