# AI 代标注接受记录（2026-11-08）

- 批准人：项目负责人（用户）
- 会话原话：“先别纠结非要让我人工标注了，我已经让别的agent 代为处理了”
- 决定：**接受 AI 代复核标注作为第二标注源**，不再要求负责人本人完成 §4–§6 的人工标注。
- 该决定只改变“标注来源”的流程，不改变结论等级：

## 边界（必须保留）

1. 两位标注者都是 AI（原 agent 标注 + `agent:codex-owner-delegate-not-human`），一致性只能叫 **AI–AI agreement**，**不是** human–agent agreement，**不是**双人 kappa。
2. delegate 标注者自述先读了 README §3（含 agent 标签摘要），**不构成独立盲评**；本 agreement 仅描述性。
3. 不得据此声称 B4 校准达标、B5 效果结论、或“已通过人类评审”。
4. B5 盲评状态保持 **partial（AI-delegate mode；无真人标注）**。
5. 如果未来出现第二名真人，仍按 `B5-blind-protocol.md` §4–§6 重做真人双标注并升级结论。

## 产物

- `eval/evidence/b5blind/agreement-ai.json`（`agreement-ai.mjs` 生成：逐字段 agreements/agreementRate/可定义时的 Cohen's kappa；单类别时 kappa=null 并注明 undefined）
- `eval/evidence/b5blind/owner-labels.delegate.json`（原样保留 labeler=agent:...）
- `eval/evidence/b5blind/delegate-comparison.json`（描述性 AI–AI 对比）
