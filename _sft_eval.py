"""
Post-training evaluation: load base model + LoRA adapter, run on held-out
eval cells, score against the v3.5 rubric.

For meaningful generalization signal, the eval graphs MUST be brand-new
(not in training data). The expected setup:
    graphs/eval1_*.json
    graphs/eval2_*.json
    graphs/eval3_*.json

Each eval graph has its own EVAL_QUESTIONS entry in this file (with
expected answer probes per question). Score is a per-cell rubric.

Usage:
    python _sft_eval.py \\
        --base_model unsloth/Qwen3-4B-Instruct-2507 \\
        --adapter adapters/qwen3_4b_v35_run1 \\
        --output_path results/eval_run1.json

Produces a side-by-side report comparing trained vs untrained baseline if
--also_baseline is passed.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any


# Eval cells: (graph_stem, question_key, question, expected_answer_probes)
# Each probe is a case-insensitive substring we'd expect a correct answer to
# contain. Probes are intentionally loose — we want "answer is in the right
# region" rather than byte-identical match.
#
# Question pairs per graph:
#   *_sufficient — fully answerable from the graph (compute / classify)
#   *_partial    — requires hypothesizing beyond the graph but anchored to it
EVAL_CELLS: list[tuple[str, str, str, list[str]]] = [
    # ---- eval1_brendrian (numerical formula) ----
    (
        "eval1_brendrian",
        "brendrian_sufficient_overheat_check",
        "A Brendrian rod has density 7500 kg/m^3 and a temperature gradient of 40 K/m. "
        "Does it overheat? Show the flux value you compute and your verdict.",
        # density factor = 1 + 2e-4 * (7500-5000) = 1.5
        # q_b = 5e-5 * 40^4 * 1.5 = 5e-5 * 2_560_000 * 1.5 = 192 W/m^2
        # 192 << 1e5, so SAFE
        ["192", "safe", "no overheat"],
    ),
    (
        "eval1_brendrian",
        "brendrian_partial_gradient_for_safety",
        "Roughly what is the largest temperature gradient (in K/m) a Brendrian rod at "
        "the reference density can sustain before overheating? Give an order-of-magnitude estimate.",
        # at rho_ref, factor = 1, so q_safe = 5e-5 * x^4 => x^4 = 2e9 => x ~ 211 K/m
        ["200", "210", "order of 10^2", "around 200"],
    ),

    # ---- eval2_tarsil (procedural cipher) ----
    (
        "eval2_tarsil",
        "tarsil_sufficient_classify_DDE",
        "Run the Tarsil validation on the input DDE and report the final output.",
        # w = 11, 11, 13. W = 11*1 + 11*2 + 13*3 = 11 + 22 + 39 = 72.
        # 72 mod 9 = 0 => Rule A => ACCEPT-PRIME
        ["ACCEPT-PRIME", "accept-prime"],
    ),
    (
        "eval2_tarsil",
        "tarsil_partial_ill_formed_input",
        "What does the Tarsil cipher do when the input is ABZ? Explain your reasoning.",
        # Z not in alphabet => ILL-FORMED before any computation
        ["ill-formed", "ILL-FORMED", "not in", "outside", "reject"],
    ),

    # ---- eval3_naroth (tournament decision) ----
    (
        "eval3_naroth",
        "naroth_sufficient_unique_top",
        "In a Naroth round-robin, T1 (seed 1) finished 3-0-0, T2 (seed 2) finished 1-1-1, "
        "T3 (seed 3) finished 1-1-1, T4 (seed 4) finished 0-1-2. Which team advances?",
        # Base scores: T1=9, T2=4, T3=4, T4=1. Unique top => T1
        ["T1", "team 1", "seed 1"],
    ),
    (
        "eval3_naroth",
        "naroth_partial_head_to_head_does_not_decide",
        "Two teams finish tied on base score AND tied on Naroth strength. One beat the other "
        "in their head-to-head match. Is the head-to-head result enough to decide who advances? "
        "Justify your answer.",
        # No — head-to-head doesn't enter the tiebreaker; lower seed wins
        ["no", "lower seed", "seed", "head-to-head does not"],
    ),
]


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", default="unsloth/Qwen3-4B-Instruct-2507")
    ap.add_argument("--adapter", required=True, help="Trained adapter directory")
    ap.add_argument("--output_path", default="results/eval.json")
    ap.add_argument("--also_baseline", action="store_true",
                    help="Also run the base model alone for side-by-side comparison")
    ap.add_argument("--samples_per_cell", type=int, default=3)
    ap.add_argument("--temperature", type=float, default=0.3)
    ap.add_argument("--max_seq_length", type=int, default=4096)
    ap.add_argument("--max_new_tokens", type=int, default=2048)
    return ap.parse_args()


# v3.5 parsing
_REASONING_RE = re.compile(r"<reasoning>(.*?)</reasoning>", re.DOTALL | re.IGNORECASE)
_ANSWER_RE = re.compile(r"<answer>(.*?)</answer>", re.DOTALL | re.IGNORECASE)
_META_LEAK_RE = re.compile(
    r"\b(the knowledge graph|the graph|the context|the reference|the nodes|"
    r"the absorbed material|the anchors|node id|UNKNOWN section|reasoning above)\b",
    re.IGNORECASE,
)


def split_response(content: str) -> tuple[str, str]:
    rm = _REASONING_RE.search(content)
    am = _ANSWER_RE.search(content)
    return (
        rm.group(1).strip() if rm else "",
        am.group(1).strip() if am else content.strip(),
    )


def score_response(content: str, expected_probes: list[str], graph_node_ids: set[str]) -> dict[str, Any]:
    reasoning, answer = split_response(content)
    has_reasoning = bool(reasoning)
    has_answer = bool(answer)
    has_KNOWN = "KNOWN" in reasoning
    has_UNKNOWN = "UNKNOWN" in reasoning
    has_HYPOTHESES = "HYPOTHES" in reasoning.upper()
    leak_meta = bool(_META_LEAK_RE.search(answer))
    leaked_nodes = [nid for nid in graph_node_ids if nid in answer]
    correct = any(p in answer for p in expected_probes) if expected_probes else None
    return {
        "has_reasoning": has_reasoning,
        "has_answer": has_answer,
        "has_KNOWN": has_KNOWN,
        "has_UNKNOWN": has_UNKNOWN,
        "has_HYPOTHESES": has_HYPOTHESES,
        "answer_leaks_meta": leak_meta,
        "answer_leaks_node_ids": bool(leaked_nodes),
        "leaked_node_ids": leaked_nodes,
        "correct_substring_hit": correct,
        "reasoning_chars": len(reasoning),
        "answer_chars": len(answer),
    }


def load_node_ids(graph_stem: str) -> set[str]:
    p = Path(f"graphs/{graph_stem}.json")
    if not p.exists():
        return set()
    g = json.loads(p.read_text(encoding="utf-8"))
    return {n["id"] for n in g.get("nodes", [])}


def main():
    args = parse_args()
    out_path = Path(args.output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not EVAL_CELLS:
        print("ERROR: No EVAL_CELLS defined yet. Populate the EVAL_CELLS list in _sft_eval.py")
        print("after building the held-out eval graphs (eval1_*, eval2_*, eval3_*).")
        return

    from _anchor_filtered_prompt import build_v35_prompt_filtered

    print("Importing unsloth, transformers...")
    from unsloth import FastLanguageModel

    def load_model_with_adapter(adapter_path: str | None):
        print(f"Loading base: {args.base_model}    adapter: {adapter_path or '<none>'}")
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.base_model,
            max_seq_length=args.max_seq_length,
            load_in_4bit=True,
            dtype=None,
        )
        if adapter_path:
            model.load_adapter(adapter_path, adapter_name="trained")
            model.set_adapter("trained")
        FastLanguageModel.for_inference(model)
        return model, tokenizer

    def generate(model, tokenizer, prompt: str) -> str:
        messages = [{"role": "user", "content": prompt}]
        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )
        inputs = tokenizer(text, return_tensors="pt").to(model.device)
        outputs = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            do_sample=True,
            top_p=0.9,
        )
        full = tokenizer.decode(outputs[0], skip_special_tokens=True)
        # Strip the prompt prefix off the front
        return full[len(text):] if full.startswith(text) else full

    runs: list[dict[str, Any]] = []

    for model_label, adapter_path in [
        ("trained", args.adapter),
        ("baseline", None) if args.also_baseline else (None, None),
    ]:
        if model_label is None:
            continue
        model, tokenizer = load_model_with_adapter(adapter_path)
        for cell_idx, (graph_stem, qkey, question, probes) in enumerate(EVAL_CELLS, 1):
            graph_path = f"graphs/{graph_stem}.json"
            prompt, _ = build_v35_prompt_filtered(
                question, graph_path,
                k_anchors=12, hop=1,
                inject_hypothesis_pool=False,
            )
            node_ids = load_node_ids(graph_stem)
            for sample_idx in range(1, args.samples_per_cell + 1):
                print(f"[{model_label}] cell {cell_idx}/{len(EVAL_CELLS)} sample {sample_idx}: {graph_stem}::{qkey}")
                t0 = time.perf_counter()
                content = generate(model, tokenizer, prompt)
                dt = time.perf_counter() - t0
                rb = score_response(content, probes, node_ids)
                runs.append({
                    "model_label": model_label,
                    "graph_stem": graph_stem,
                    "question_key": qkey,
                    "sample_idx": sample_idx,
                    "wall_sec": round(dt, 2),
                    "raw_content": content,
                    "rubric": rb,
                })

    # Summarize by model_label + cell
    summary: dict[str, dict[str, Any]] = {}
    for r in runs:
        key = r["model_label"]
        s = summary.setdefault(key, {
            "n": 0, "structural_pass": 0, "correct": 0, "meta_leak": 0,
            "node_id_leak": 0, "total_wall_sec": 0.0,
        })
        s["n"] += 1
        rb = r["rubric"]
        if rb["has_reasoning"] and rb["has_answer"] and rb["has_KNOWN"]:
            s["structural_pass"] += 1
        if rb.get("correct_substring_hit") is True:
            s["correct"] += 1
        if rb["answer_leaks_meta"]:
            s["meta_leak"] += 1
        if rb["answer_leaks_node_ids"]:
            s["node_id_leak"] += 1
        s["total_wall_sec"] += r["wall_sec"]

    out = {"runs": runs, "summary": summary, "config": vars(args)}
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'=' * 60}")
    print(f"EVAL SUMMARY  ->  {out_path}")
    print(f"{'=' * 60}")
    for label, s in summary.items():
        n = s["n"]
        print(f"\n{label}:")
        print(f"  trials                 : {n}")
        print(f"  structural pass        : {s['structural_pass']}/{n}  ({100*s['structural_pass']/n:.0f}%)")
        print(f"  correct (substring)    : {s['correct']}/{n}  ({100*s['correct']/n:.0f}%)")
        print(f"  meta leaked            : {s['meta_leak']}/{n}")
        print(f"  node_id leaked         : {s['node_id_leak']}/{n}")
        print(f"  mean wall              : {s['total_wall_sec']/n:.1f}s")


if __name__ == "__main__":
    main()
