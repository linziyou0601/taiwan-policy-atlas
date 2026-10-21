#!/usr/bin/env python3
"""
Aggregate benchmark results from individual grading.json files into benchmark.json.

Usage:
    python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>

Reads all grading.json files under the iteration directory, computes pass_rate
mean/stddev per configuration (with_skill vs without_skill), and writes
benchmark.json with the aggregated results.

This script exists because LLM arithmetic is unreliable for aggregation tasks
(e.g., computing means and standard deviations across multiple runs). Deterministic
Python ensures benchmark numbers are correct.
"""

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_grading(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def load_timing(path: Path) -> dict:
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


def compute_stats(values: list[float]) -> dict:
    if not values:
        return {"mean": 0.0, "stddev": 0.0, "min": 0.0, "max": 0.0}
    n = len(values)
    mean = sum(values) / n
    if n > 1:
        variance = sum((x - mean) ** 2 for x in values) / (n - 1)
        stddev = math.sqrt(variance)
    else:
        stddev = 0.0
    return {
        "mean": round(mean, 2),
        "stddev": round(stddev, 2),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
    }


def main():
    if len(sys.argv) < 4 or "--skill-name" not in sys.argv:
        print("Usage: python -m scripts.aggregate_benchmark <iteration-dir> --skill-name <name>")
        sys.exit(1)

    iteration_dir = Path(sys.argv[1])
    skill_name_idx = sys.argv.index("--skill-name") + 1
    skill_name = sys.argv[skill_name_idx]

    if not iteration_dir.exists():
        print(f"Error: directory {iteration_dir} does not exist")
        sys.exit(1)

    runs = []
    eval_dirs = sorted(
        [d for d in iteration_dir.iterdir() if d.is_dir() and d.name.startswith("eval-")]
    )

    for eval_dir in eval_dirs:
        eval_id_str = eval_dir.name.replace("eval-", "")
        try:
            eval_id = int(eval_id_str)
        except ValueError:
            eval_id = eval_id_str

        for config in ["with_skill", "without_skill"]:
            config_dir = eval_dir / config
            if not config_dir.exists():
                continue

            grading_path = eval_dir / "grading.json"
            if config == "without_skill":
                grading_path = eval_dir / f"grading-{config}.json"
                if not grading_path.exists():
                    grading_path = eval_dir / "grading.json"

            run_dirs = sorted(
                [d for d in config_dir.iterdir() if d.is_dir() and d.name.startswith("run-")]
            ) if any(d.name.startswith("run-") for d in config_dir.iterdir() if d.is_dir()) else [config_dir]

            for run_idx, run_dir in enumerate(run_dirs, 1):
                grading_file = run_dir / "grading.json"
                if not grading_file.exists():
                    grading_file = eval_dir / f"grading-{config}-{run_idx}.json"
                if not grading_file.exists():
                    continue

                grading = load_grading(grading_file)
                timing = load_timing(run_dir / "timing.json")
                if not timing:
                    timing = load_timing(eval_dir / f"timing-{config}-{run_idx}.json")

                summary = grading.get("summary", {})
                run_entry = {
                    "eval_id": eval_id,
                    "eval_name": eval_dir.name,
                    "configuration": config,
                    "run_number": run_idx,
                    "result": {
                        "pass_rate": summary.get("pass_rate", 0.0),
                        "passed": summary.get("passed", 0),
                        "failed": summary.get("failed", 0),
                        "total": summary.get("total", 0),
                        "time_seconds": timing.get("total_duration_seconds", 0.0),
                        "tokens": timing.get("total_tokens", 0),
                        "tool_calls": grading.get("execution_metrics", {}).get("total_tool_calls", 0),
                        "errors": grading.get("execution_metrics", {}).get("errors_encountered", 0),
                    },
                    "expectations": grading.get("expectations", []),
                }

                notes = grading.get("user_notes_summary", {})
                if notes:
                    all_notes = (
                        notes.get("uncertainties", [])
                        + notes.get("workarounds", [])
                    )
                    if all_notes:
                        run_entry["notes"] = all_notes

                runs.append(run_entry)

    with_skill_rates = [r["result"]["pass_rate"] for r in runs if r["configuration"] == "with_skill"]
    without_skill_rates = [r["result"]["pass_rate"] for r in runs if r["configuration"] == "without_skill"]
    with_skill_times = [r["result"]["time_seconds"] for r in runs if r["configuration"] == "with_skill"]
    without_skill_times = [r["result"]["time_seconds"] for r in runs if r["configuration"] == "without_skill"]
    with_skill_tokens = [r["result"]["tokens"] for r in runs if r["configuration"] == "with_skill"]
    without_skill_tokens = [r["result"]["tokens"] for r in runs if r["configuration"] == "without_skill"]

    with_stats = compute_stats(with_skill_rates)
    without_stats = compute_stats(without_skill_rates)

    delta_rate = with_stats["mean"] - without_stats["mean"]
    delta_time = compute_stats(with_skill_times)["mean"] - compute_stats(without_skill_times)["mean"]
    delta_tokens = compute_stats(with_skill_tokens)["mean"] - compute_stats(without_skill_tokens)["mean"]

    eval_ids = sorted(set(r["eval_id"] for r in runs))

    benchmark = {
        "metadata": {
            "skill_name": skill_name,
            "skill_path": "",
            "executor_model": "unknown",
            "analyzer_model": "unknown",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "evals_run": eval_ids,
            "runs_per_configuration": max(
                len([r for r in runs if r["configuration"] == "with_skill" and r["eval_id"] == eval_ids[0]]),
                1,
            ) if eval_ids else 1,
        },
        "runs": runs,
        "run_summary": {
            "with_skill": {
                "pass_rate": compute_stats(with_skill_rates),
                "time_seconds": compute_stats(with_skill_times),
                "tokens": compute_stats(with_skill_tokens),
            },
            "without_skill": {
                "pass_rate": compute_stats(without_skill_rates),
                "time_seconds": compute_stats(without_skill_times),
                "tokens": compute_stats(without_skill_tokens),
            },
            "delta": {
                "pass_rate": f"{delta_rate:+.2f}",
                "time_seconds": f"{delta_time:+.1f}",
                "tokens": f"{delta_tokens:+.0f}",
            },
        },
        "notes": [],
    }

    output_path = iteration_dir / "benchmark.json"
    with open(output_path, "w") as f:
        json.dump(benchmark, f, indent=2, ensure_ascii=False)

    print(f"Benchmark written to {output_path}")
    print(f"  With skill:    pass_rate mean={with_stats['mean']:.2f} stddev={with_stats['stddev']:.2f}")
    print(f"  Without skill: pass_rate mean={without_stats['mean']:.2f} stddev={without_stats['stddev']:.2f}")
    print(f"  Delta:         {delta_rate:+.2f}")

    if delta_rate > 0.20:
        print("  Verdict: High Value")
    elif delta_rate <= 0:
        print("  Verdict: Outgrowth")
    elif abs(delta_rate) < 0.05:
        print("  Verdict: Inconclusive")
    else:
        print(f"  Verdict: Moderate Value (delta={delta_rate:.2f})")


if __name__ == "__main__":
    main()
