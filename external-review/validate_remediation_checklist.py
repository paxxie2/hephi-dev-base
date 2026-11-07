from pathlib import Path
import re

root = Path(__file__).resolve().parent
path = root / "HEPHI-R2-remediation-checklist.md"
text = path.read_text(encoding="utf-8")
assert path.stat().st_size > 20000

for section in ["R0", "R1", "R2", "R3", "R4", "R5"]:
    assert re.search(rf"^## {section}｜", text, re.M), f"缺少工作包 {section}"

expected_sequences = {
    "R1-T": range(1, 13),
    "R2-T": range(1, 9),
    "R3-T": range(1, 18),
    "R5-A": range(1, 13),
}
for prefix, numbers in expected_sequences.items():
    expected = [f"{prefix}{number:02d}" for number in numbers]
    found = sorted(set(re.findall(rf"{prefix}\d{{2}}", text)))
    assert found == expected, f"{prefix} 用例不连续：{found}"

# 每个测试表格行只能定义一次；后文引用范围允许出现区间端点。
for prefix, numbers in expected_sequences.items():
    for number in numbers:
        case_id = f"{prefix}{number:02d}"
        assert len(re.findall(rf"^\| {case_id}(?: |｜)", text, re.M)) == 1, f"用例定义重复或缺失：{case_id}"

required_phrases = [
    "全部 pending",
    "5efd7084e75c5bfbb77fcdd5e6adb1443f834ff1",
    "/Users/zm/dsh-instances/experiment/hephi-review",
    "git@github.com:paxxie2/super-agent-hephi-review.git",
    "version: 2",
    "v1／无版本旧合同只读兼容",
    "dirty 直接失败",
    "releases/<fullSHA>/",
    "自动恢复 previous",
    "describePlugin()",
    "真实 P8 不得标 done",
    "Node `22.19.0`",
    "GATE-B5-PILOT 和 FORMAL 在原硬依赖全部满足前不得放行",
]
for phrase in required_phrases:
    assert phrase in text, f"缺少关键约束：{phrase}"

repo = root / "hephi-review"
protected = [
    "hephi/src/control/evidence-verifier.ts",
    "hephi/src/control/check-runner.ts",
    "hephi/src/control/check-store.ts",
    "hephi/src/control/worker-mount.ts",
    "hephi/src/control/decision-log.ts",
    "hephi/tests/control/evidence-verifier.test.ts",
    "hephi/tests/control/plugin-version.test.ts",
    "hephi/tests/control/decision-log.test.ts",
    "hephi/tests/control/worker-mount.test.ts",
]
for name in protected:
    assert name in text, f"受保护文件未登记：{name}"
    assert (repo / name).is_file(), f"受保护文件在基线中不存在：{name}"

print("PASS：R0–R5 工作包完整")
print("PASS：R1 12、R2 8、R3 17、R5 12 项用例编号连续且定义唯一")
print("PASS：基线、目录、远端、pending、Node 版本与 B5 限制齐全")
print("PASS：旧合同兼容、dirty 拒绝、不可变发布、自动回滚和实载边界齐全")
print("PASS：9 个受保护文件均登记且存在于审查基线")
