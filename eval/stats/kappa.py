#!/usr/bin/env python3
"""ROADMAP-95 工作线 B / B4：两名盲评者的 Cohen's kappa（statsmodels 实现）。

口径：正式评分前，两名标注者的 Cohen's kappa 必须 >= 0.7 才进入正式评分
（见 eval/label/RUBRIC.md §2）。本脚本是**统计库实现**；`eval/kappa.mjs` 保留为
Node 侧兼容预检，不作为正式统计口径。

输入沿用 `eval/kappa.mjs` 的格式：

    {
      "labels": ["pass", "fail"],          # 可选；缺省按出现过的标签推导
      "items": [
        { "id": "case-001", "raterA": "pass", "raterB": "fail" },
        ...
      ]
    }

用法：

    python3 eval/stats/kappa.py --scores <scores.json> [--min 0.7] [--json]
    python3 eval/stats/kappa.py --self-test [--json]

输出（--json）：n、kappa、threshold、pass（另附 labels/po/pe/undefined/method）。
未传 --json 时输出人类可读摘要。

退出码：
    0 = kappa 有定义且 >= 门槛（达标）
    1 = kappa < 门槛，或 kappa 无定义（全同标签/零方差），或自测失败
    2 = 输入/环境错误（缺依赖、文件缺失、非法 JSON、未知标签、非法参数等）

无定义（所有标签相同/零方差）时 kappa 输出为 null 且 `undefined=true`，退出码 1；
**绝不**把无定义当成 1。kappa 的数值只来自 `statsmodels.stats.inter_rater.cohens_kappa`，
本脚本不手写 kappa 公式。
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

DEFAULT_MIN = 0.7
MIN_KAPPA = -1.0

REQUIRED_DEPENDENCIES = [("numpy", "numpy"), ("statsmodels", "statsmodels")]


def _missing_dependency_message(missing: list[str]) -> str:
    pin = "\n".join(f"  - {name}" for name in missing)
    return (
        "[kappa] 缺少统计依赖：\n"
        f"{pin}\n"
        "请先安装固定版本（见 eval/stats/requirements.txt）：\n"
        "  python3 -m venv .venv\n"
        "  .venv/bin/pip install -r eval/stats/requirements.txt\n"
        "  .venv/bin/python eval/stats/kappa.py --scores <scores.json>"
    )


try:  # 依赖守卫：缺依赖时给清晰错误并 exit 2，不抛栈。
    import numpy as np
    import statsmodels
    from statsmodels.stats.inter_rater import cohens_kappa
except ImportError as exc:  # pragma: no cover - 环境相关
    missing = []
    for display, module in REQUIRED_DEPENDENCIES:
        try:
            __import__(module)
        except ImportError:
            missing.append(display)
    if not missing:
        missing = [exc.name or "unknown"]
    print(_missing_dependency_message(missing), file=sys.stderr)
    sys.exit(2)


class ScoresError(ValueError):
    """输入数据不合法（映射到退出码 2）。"""


def _require_number(value, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ScoresError(f"{name} 必须是数字") from None
    if not math.isfinite(number):
        raise ScoresError(f"{name} 必须是有限数字")
    return number


def table_from_scores(data) -> tuple[list[str], np.ndarray, int]:
    """把 kappa.mjs 的输入整理成 labels + 混淆矩阵（纯数据整理，不算 kappa）。"""
    if not isinstance(data, dict):
        raise ScoresError("评分文件顶层必须是对象")
    items = data.get("items")
    if not isinstance(items, list):
        raise ScoresError("items 必须是数组")
    if len(items) == 0:
        raise ScoresError("items 为空，无法计算 kappa")

    labels = data.get("labels")
    if labels is None or (isinstance(labels, list) and len(labels) == 0):
        derived = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ScoresError(f"items[{index}] 必须是对象")
            for key in ("raterA", "raterB"):
                if key not in item:
                    raise ScoresError(f"items[{index}] 缺少 {key}")
                if item[key] not in derived:
                    derived.append(item[key])
        labels = derived
    if not isinstance(labels, list):
        raise ScoresError("labels 必须是数组")
    if len(labels) == 0:
        raise ScoresError("labels 为空，无法计算 kappa")
    for label in labels:
        if not isinstance(label, str) or label == "":
            raise ScoresError(f"labels 只能是字符串：{label!r}")
    if len(set(labels)) != len(labels):
        raise ScoresError("labels 有重复项")

    positions = {label: index for index, label in enumerate(labels)}
    table = np.zeros((len(labels), len(labels)), dtype=float)
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ScoresError(f"items[{index}] 必须是对象")
        for key in ("raterA", "raterB"):
            if key not in item:
                raise ScoresError(f"items[{index}] 缺少 {key}")
            if item[key] not in positions:
                raise ScoresError(f"items[{index}].{key} 是未知标签：{item[key]!r}，labels={labels}")
        table[positions[item["raterA"]], positions[item["raterB"]]] += 1
    return labels, table, len(items)


def compute(data) -> dict:
    """调用 statsmodels 计算 kappa；无定义返回 kappa=None 且 undefined=True。"""
    labels, table, n = table_from_scores(data)
    # 描述性统计（仅用于报告；kappa 本身必须来自 statsmodels）。
    observed = float(np.trace(table) / n)
    row = table.sum(axis=1) / n
    col = table.sum(axis=0) / n
    expected = float(np.dot(row, col))
    with warnings.catch_warnings():
        # 无定义时 statsmodels 内部会出现 0/0 的 RuntimeWarning，属预期。
        warnings.simplefilter("ignore", RuntimeWarning)
        result = cohens_kappa(table)
    kappa = float(result.kappa)
    undefined = (not math.isfinite(kappa)) or expected >= 1.0 - 1e-12
    return {
        "n": n,
        "labels": labels,
        "po": observed,
        "pe": expected,
        "kappa": None if undefined else kappa,
        "undefined": bool(undefined),
        "method": "statsmodels.stats.inter_rater.cohens_kappa",
        "statsmodels_version": statsmodels.__version__,
        "table": table.astype(int).tolist(),
    }


def decide(computed: dict, threshold: float) -> dict:
    passed = (not computed["undefined"]) and computed["kappa"] is not None and computed["kappa"] >= threshold
    return {
        "n": computed["n"],
        "kappa": computed["kappa"],
        "threshold": threshold,
        "pass": bool(passed),
        "undefined": computed["undefined"],
        "labels": computed["labels"],
        "po": computed["po"],
        "pe": computed["pe"],
        "method": computed["method"],
        "statsmodels_version": computed["statsmodels_version"],
    }


def load_scores(path: str):
    file = Path(path)
    if not file.exists():
        raise ScoresError(f"评分文件不存在：{path}")
    try:
        text = file.read_text(encoding="utf-8")
    except OSError as error:
        raise ScoresError(f"评分文件无法读取：{error}") from None
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise ScoresError(f"评分文件不是合法 JSON：{error}") from None


def render_text(report: dict, file: str) -> str:
    lines = [
        f"文件：{file}",
        f"样本数 n：{report['n']}",
        f"标签：{','.join(report['labels'])}",
        f"观测一致率 po：{report['po']:.4f}",
        f"期望一致率 pe：{report['pe']:.4f}",
        ("Cohen's kappa：undefined（无定义：全同标签/零方差，不得视为 1）" if report["undefined"]
         else f"Cohen's kappa：{report['kappa']:.4f}（statsmodels {report['statsmodels_version']}）"),
        f"门槛 threshold：{report['threshold']}",
        f"判定：{'PASS（达标）' if report['pass'] else 'FAIL（不达标或无定义）'}",
    ]
    return "\n".join(lines)


def run_cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Cohen's kappa（statsmodels 实现；输入沿用 eval/kappa.mjs 的 labels/items/raterA/raterB）",
    )
    parser.add_argument("--scores", help="评分 JSON（labels/items/raterA/raterB）")
    parser.add_argument("--min", dest="threshold", default=str(DEFAULT_MIN), help=f"kappa 门槛（默认 {DEFAULT_MIN}）")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--self-test", action="store_true", help="用合成数据跑 B4-03/04/05 + 非法输入自测")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test(args.json)
    if not args.scores:
        print("[kappa] 需要 --scores <scores.json>（或使用 --self-test）", file=sys.stderr)
        return 2
    try:
        threshold = _require_number(args.threshold, "--min")
    except ScoresError as error:
        print(f"[kappa] {error}", file=sys.stderr)
        return 2
    try:
        data = load_scores(args.scores)
        computed = compute(data)
    except ScoresError as error:
        print(f"[kappa] 输入不合法：{error}", file=sys.stderr)
        return 2
    report = decide(computed, threshold)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_text(report, args.scores))
    if report["undefined"]:
        print("[kappa] kappa 无定义（所有标签相同/零方差），按“不达标”处理，不得视为 1。", file=sys.stderr)
        return 1
    return 0 if report["pass"] else 1


# ---- 自测 -------------------------------------------------------------------

def _items(pairs: list[tuple[str, str]]) -> list[dict]:
    return [
        {"id": f"case-{index + 1:03d}", "raterA": a, "raterB": b}
        for index, (a, b) in enumerate(pairs)
    ]


def _cli(scores_path: str | None, *extra: str) -> tuple[int, str, str]:
    command = [sys.executable, str(Path(__file__).resolve()), "--json", *extra]
    if scores_path is not None:
        command += ["--scores", scores_path]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
    return completed.returncode, completed.stdout, completed.stderr


def self_test(as_json: bool = False) -> int:
    steps: list[dict] = []

    def record(step_id: str, name: str, ok: bool, detail: str) -> None:
        steps.append({"id": step_id, "name": name, "ok": bool(ok), "detail": detail})

    # 确认 kappa 确实来自 statsmodels，而不是本脚本自写公式。
    record(
        "deps",
        "kappa 实现来自 statsmodels.stats.inter_rater.cohens_kappa",
        cohens_kappa.__module__.startswith("statsmodels."),
        f"module={cohens_kappa.__module__}",
    )

    with tempfile.TemporaryDirectory(prefix="hephi-kappa-") as tmp:
        root = Path(tmp)

        def write(name: str, payload) -> str:
            path = root / name
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            return str(path)

        # B4-03：完全一致 → kappa=1，达到 0.7 门槛，exit 0。
        b403 = {
            "labels": ["pass", "fail"],
            "items": _items([("pass", "pass")] * 3 + [("fail", "fail")] * 3),
        }
        b403_path = write("b403.json", b403)
        b403_computed = compute(b403)
        b403_code, b403_out, b403_err = _cli(b403_path)
        b403_json = json.loads(b403_out) if b403_out.strip() else {}
        record(
            "B4-03", "完全一致 → kappa=1 且 pass",
            b403_code == 0 and abs(b403_json.get("kappa", 0) - 1.0) < 1e-12 and b403_json.get("pass") is True,
            f"exit={b403_code} kappa={b403_json.get('kappa')} pass={b403_json.get('pass')} err={b403_err[:120]}",
        )
        record(
            "B4-03", "完全一致时 statsmodels 输入矩阵正确",
            b403_computed["table"] == [[3, 0], [0, 3]] and b403_computed["po"] == 1.0,
            json.dumps({"table": b403_computed["table"], "po": b403_computed["po"]}),
        )

        # B4-04：两类边际平衡、观测一致率 0.5 → pe=0.5 → kappa=0，低于门槛 exit 1。
        b404 = {
            "labels": ["pass", "fail"],
            "items": _items([("pass", "pass"), ("pass", "fail"), ("fail", "pass"), ("fail", "fail")]),
        }
        b404_path = write("b404.json", b404)
        b404_computed = compute(b404)
        b404_code, b404_out, b404_err = _cli(b404_path)
        b404_json = json.loads(b404_out) if b404_out.strip() else {}
        record(
            "B4-04", "边际平衡 po=0.5 → kappa=0 且不达标 exit 1",
            abs(b404_json.get("kappa", 1) - 0.0) < 1e-12 and b404_json.get("pass") is False and b404_code == 1,
            f"exit={b404_code} kappa={b404_json.get('kappa')} po={b404_json.get('po')} pe={b404_json.get('pe')}",
        )
        record(
            "B4-04", "po/pe 均为 0.5（已知答案）",
            abs(b404_computed["po"] - 0.5) < 1e-12 and abs(b404_computed["pe"] - 0.5) < 1e-12,
            json.dumps({"po": b404_computed["po"], "pe": b404_computed["pe"]}),
        )

        # B4-05：全同标签 → kappa 无定义，不得返回假 1，exit 1。
        b405 = {
            "labels": ["pass", "fail"],
            "items": _items([("pass", "pass")] * 6),
        }
        b405_path = write("b405.json", b405)
        b405_code, b405_out, b405_err = _cli(b405_path)
        b405_json = json.loads(b405_out) if b405_out.strip() else {}
        record(
            "B4-05", "全同标签 → kappa=null/undefined，pass=false，exit 1，绝不为 1",
            b405_code == 1
            and b405_json.get("kappa") is None
            and b405_json.get("undefined") is True
            and b405_json.get("pass") is False,
            f"exit={b405_code} kappa={b405_json.get('kappa')} undefined={b405_json.get('undefined')} pass={b405_json.get('pass')}",
        )

        # 非法输入：一律 exit 2。
        missing = _cli(str(root / "does-not-exist.json"))
        record("invalid", "文件不存在 → exit 2", missing[0] == 2, f"exit={missing[0]} err={missing[2][:120]}")

        bad_json = root / "bad.json"
        bad_json.write_text("{not json", encoding="utf-8")
        bad_json_run = _cli(str(bad_json))
        record("invalid", "非法 JSON → exit 2", bad_json_run[0] == 2, f"exit={bad_json_run[0]} err={bad_json_run[2][:120]}")

        empty_path = write("empty.json", {"labels": ["pass", "fail"], "items": []})
        empty_run = _cli(empty_path)
        record("invalid", "items 为空 → exit 2", empty_run[0] == 2, f"exit={empty_run[0]} err={empty_run[2][:120]}")

        unknown_path = write(
            "unknown.json",
            {"labels": ["pass", "fail"], "items": _items([("pass", "maybe")])},
        )
        unknown_run = _cli(unknown_path)
        record("invalid", "未知标签 → exit 2", unknown_run[0] == 2, f"exit={unknown_run[0]} err={unknown_run[2][:160]}")

        missing_flag = _cli(None)
        record("invalid", "缺 --scores → exit 2", missing_flag[0] == 2, f"exit={missing_flag[0]} err={missing_flag[2][:120]}")

        bad_min = _cli(b403_path, "--min", "not-a-number")
        record("invalid", "--min 非数字 → exit 2", bad_min[0] == 2, f"exit={bad_min[0]} err={bad_min[2][:120]}")

    ok = all(step["ok"] for step in steps)
    if as_json:
        print(json.dumps({"selfTest": ok, "steps": steps}, ensure_ascii=False, indent=2))
    else:
        for step in steps:
            print(f"{'PASS' if step['ok'] else 'FAIL'} [{step['id']}] {step['name']} :: {step['detail']}")
        print("SELF-TEST: PASS" if ok else "SELF-TEST: FAIL")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    return run_cli(argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
