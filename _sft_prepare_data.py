"""
SFT data preparation for run 1.

Walks the four trace directories we have, applies selection rules, and
emits a JSONL file ready for unsloth-style training:

    {"messages": [
        {"role": "user", "content": <full v3.5 prompt>},
        {"role": "assistant", "content": "<reasoning>...</reasoning>\\n<answer>...</answer>"}
    ]}

Selection rules for run 1 (proof-of-concept on RTX 4050 / QLoRA / 2K ctx):

  1. Pick at most one trace per (graph, question, round) tuple. "Round"
     differentiates round 1 / round 2 / round 3 of the partial questions
     — they have meaningfully different prompts (no pool, small pool,
     larger pool), so they count as separate examples.

  2. Skip cs4 entirely — its prompts run ~6K tokens and our local 4050
     can only fit max_seq_length=2048 with QLoRA + grad checkpointing.

  3. Skip any trace whose tokenized full prompt+completion exceeds 2048.

  4. Skip traces that fail the structural rubric (must have non-empty
     reasoning AND answer blocks). Correctness gating is deferred per
     §11.3 of SFT_DESIGN.md.

  5. NO hypothesis-pool injection in run-1 prompts. Simpler corpus;
     we can add the mixed-pool variant in run 2.

  6. Prefer big-pickle traces over Qwen3-Instruct traces when both
     exist for the same (graph, question) pair. (Big-pickle is the
     teacher we want to distill.)

Outputs:
    data/sft_dataset/train.jsonl   ~24 examples (28 traces minus cs4 minus oversize)
    data/sft_dataset/stats.json    counts + length distribution diagnostics
    data/sft_dataset/preview.txt   first 2 examples human-readable for sanity check
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from _anchor_filtered_prompt import build_v35_prompt_filtered


# Tokenizer for length checking. Qwen3 uses BPE; we load via huggingface_hub.
def _load_qwen_tokenizer():
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(
        "unsloth/Qwen3-4B-Instruct-2507",
        trust_remote_code=True,
    )


# Source trace directories in priority order. Earlier dirs win ties.
TRACE_DIRS = [
    ("data/sft_traces",                  "round0_big_pickle"),
    ("data/sft_traces_partial",          "round1_no_pool"),
    ("data/sft_traces_partial_round2",   "round2_small_pool"),
    ("data/sft_traces_partial_round3",   "round3_larger_pool"),
    ("data/sft_traces_expanded",         "expanded"),
]


SKIP_GRAPHS = {"cs4"}           # too long for prompt budget on 4050; could revisit on rental
# We'll be training on a rental GPU (12-16 GB+ VRAM), so target 4K context.
# This fits the full corpus including the longer big-pickle traces.
MAX_SEQ_LENGTH = 4096


# Strict node-id leak detection — load all node ids per graph once
_NODE_IDS_BY_GRAPH: dict[str, set[str]] = {}


def _load_all_node_ids() -> None:
    if _NODE_IDS_BY_GRAPH:
        return
    for gp in Path("graphs").glob("*.json"):
        try:
            g = json.loads(gp.read_text(encoding="utf-8"))
        except Exception:
            continue
        _NODE_IDS_BY_GRAPH[gp.stem] = {n["id"] for n in g.get("nodes", [])}

OUT_DIR = Path("data/sft_dataset")


def passes_rubric(trace: dict[str, Any]) -> tuple[bool, str]:
    """Minimal structural rubric. Returns (passes, reason_if_not)."""
    reasoning = (trace.get("reasoning") or "").strip()
    answer = (trace.get("answer") or "").strip()
    if not reasoning:
        return False, "empty_reasoning"
    if not answer:
        return False, "empty_answer"
    if "KNOWN" not in reasoning:
        return False, "no_KNOWN_section"
    # Meta-leak rejection — answer should not mention internal structure.
    leak_re = re.compile(
        r"\b(the graph|the nodes|node id|UNKNOWN section|reasoning above)\b",
        re.IGNORECASE,
    )
    if leak_re.search(answer):
        return False, "answer_meta_leak"
    # Strict node-id leak: literal node id substrings in the user-facing answer.
    _load_all_node_ids()
    graph_stem = trace.get("graph_stem", "")
    for nid in _NODE_IDS_BY_GRAPH.get(graph_stem, set()):
        if nid in answer:
            return False, f"node_id_leak:{nid}"
    return True, ""


def reconstruct_question_from_trace(trace: dict[str, Any]) -> str | None:
    """Different trace dirs save the question field with slightly different
    keys. Normalize here so we can build the prompt the same way regardless.
    """
    return trace.get("question")


def load_traces() -> list[dict[str, Any]]:
    """Walk all source dirs, attach round metadata, return flat list."""
    all_traces: list[dict[str, Any]] = []
    for dir_str, round_label in TRACE_DIRS:
        d = Path(dir_str)
        if not d.exists():
            continue
        for p in sorted(d.glob("*.json")):
            if p.name in {"summary.json", "matrix_summary.json"}:
                continue
            try:
                t = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            t["_round_label"] = round_label
            t["_source_path"] = str(p)
            t["_source_dir"] = dir_str
            all_traces.append(t)
    return all_traces


def select_best_per_tuple(traces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """For each (graph_stem, question_key, round_label) bucket, pick the best
    trace by: (a) rubric pass, then (b) longest reasoning_chars as tiebreak.

    Within a single dir there can be multiple samples per question_key
    (s1, s2, s3 etc). We collapse those by keeping the highest-quality one.
    """
    buckets: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for t in traces:
        graph_stem = t.get("graph_stem", "?")
        # question_key in big-pickle dir is stored on the file path stem,
        # in partial dirs it's stored as a field.
        qkey = t.get("question_key")
        if not qkey:
            # Fall back to deriving from filename. Pattern is
            # "<graph>__<question_key>__sN.json" or "<graph>__<question_key>.json"
            stem = Path(t["_source_path"]).stem
            parts = stem.split("__")
            qkey = parts[1] if len(parts) >= 2 else stem
        key = (graph_stem, qkey, t["_round_label"])
        buckets.setdefault(key, []).append(t)

    selected: list[dict[str, Any]] = []
    rejected_counts: dict[str, int] = {}
    for key, candidates in buckets.items():
        passing = []
        for c in candidates:
            ok, why = passes_rubric(c)
            if ok:
                passing.append(c)
            else:
                rejected_counts[why] = rejected_counts.get(why, 0) + 1
        if not passing:
            continue
        passing.sort(key=lambda c: -(len(c.get("reasoning") or "")))
        selected.append(passing[0])

    print(f"  Selected {len(selected)} traces across {len(buckets)} unique tuples")
    if rejected_counts:
        print(f"  Rubric rejections: {rejected_counts}")
    return selected


def build_example(trace: dict[str, Any]) -> dict[str, Any] | None:
    """Reconstruct the v3.5 prompt that this trace was answering, and
    pair it with the assistant response.
    """
    graph_stem = trace["graph_stem"]
    if graph_stem in SKIP_GRAPHS:
        return None
    question = reconstruct_question_from_trace(trace)
    if not question:
        return None

    graph_path = f"E:/PROJECT/graph_final/graphs/{graph_stem}.json"
    if not Path(graph_path).exists():
        return None

    # For run 1: no hypothesis pool injection.
    prompt, diag = build_v35_prompt_filtered(
        question, graph_path,
        k_anchors=12, hop=1,
        inject_hypothesis_pool=False,
    )

    reasoning = trace["reasoning"].strip()
    answer = trace["answer"].strip()
    completion = f"<reasoning>\n{reasoning}\n</reasoning>\n\n<answer>\n{answer}\n</answer>"

    return {
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": completion},
        ],
        "_meta": {
            "graph_stem": graph_stem,
            "question_key": trace.get("question_key", "?"),
            "round_label": trace["_round_label"],
            "source_path": trace["_source_path"],
            "prompt_chars": len(prompt),
            "completion_chars": len(completion),
            "kept_nodes": diag.get("kept_nodes"),
        },
    }


def check_token_lengths(
    examples: list[dict[str, Any]],
    tokenizer,
    max_seq_length: int,
) -> list[dict[str, Any]]:
    """Tokenize each example end-to-end and drop those over the cap."""
    kept: list[dict[str, Any]] = []
    drops: list[tuple[str, int]] = []
    for ex in examples:
        # Apply the chat template the same way unsloth/HF will at training time.
        # `tokenize=False` returns the templated string; we then tokenize it
        # manually to get a flat token-id list. Using `tokenize=True` returns
        # a BatchEncoding dict whose len() is misleading (= number of keys).
        try:
            templated = tokenizer.apply_chat_template(
                ex["messages"],
                tokenize=False,
                add_generation_prompt=False,
            )
            ids = tokenizer(templated, add_special_tokens=False)["input_ids"]
        except Exception as e:
            print(f"  tokenize failed on {ex['_meta']['source_path']}: {e}")
            continue
        n = len(ids)
        ex["_meta"]["token_count"] = n
        if n > max_seq_length:
            drops.append((ex["_meta"]["source_path"], n))
            continue
        kept.append(ex)
    if drops:
        print(f"  Dropped {len(drops)} examples over {max_seq_length} tokens:")
        for path, n in drops:
            print(f"    {n:>5} tok  {path}")
    return kept


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading tokenizer (Qwen3-4B-Instruct-2507)...")
    tokenizer = _load_qwen_tokenizer()

    print("\nWalking trace directories:")
    all_traces = load_traces()
    print(f"  Found {len(all_traces)} raw traces")

    print("\nSelecting best per (graph, question, round)...")
    selected = select_best_per_tuple(all_traces)

    print(f"\nBuilding (prompt, completion) examples (skipping {SKIP_GRAPHS})...")
    raw_examples: list[dict[str, Any]] = []
    skip_counts: dict[str, int] = {}
    for t in selected:
        ex = build_example(t)
        if ex is None:
            skip_counts["graph_in_skip_list_or_invalid"] = skip_counts.get(
                "graph_in_skip_list_or_invalid", 0,
            ) + 1
            continue
        raw_examples.append(ex)
    print(f"  Built {len(raw_examples)} examples ({skip_counts} skipped)")

    print(f"\nTokenizing and dropping examples > {MAX_SEQ_LENGTH} tokens...")
    examples = check_token_lengths(raw_examples, tokenizer, MAX_SEQ_LENGTH)
    print(f"  Final dataset size: {len(examples)} examples")

    # Write the dataset
    train_path = OUT_DIR / "train.jsonl"
    with train_path.open("w", encoding="utf-8") as f:
        for ex in examples:
            payload = {"messages": ex["messages"], "meta": ex["_meta"]}
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    print(f"\nWrote {train_path}")

    # Stats
    by_graph: dict[str, int] = {}
    by_round: dict[str, int] = {}
    tok_counts: list[int] = []
    for ex in examples:
        m = ex["_meta"]
        by_graph[m["graph_stem"]] = by_graph.get(m["graph_stem"], 0) + 1
        by_round[m["round_label"]] = by_round.get(m["round_label"], 0) + 1
        tok_counts.append(m["token_count"])
    stats = {
        "n_examples": len(examples),
        "by_graph": by_graph,
        "by_round": by_round,
        "token_count_min": min(tok_counts) if tok_counts else 0,
        "token_count_max": max(tok_counts) if tok_counts else 0,
        "token_count_mean": int(sum(tok_counts) / len(tok_counts)) if tok_counts else 0,
        "max_seq_length_cap": MAX_SEQ_LENGTH,
        "skipped_graphs": sorted(SKIP_GRAPHS),
    }
    (OUT_DIR / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8",
    )

    # Preview
    preview_lines = []
    for ex in examples[:2]:
        preview_lines.append("=" * 80)
        preview_lines.append(f"GRAPH={ex['_meta']['graph_stem']}  "
                              f"ROUND={ex['_meta']['round_label']}  "
                              f"TOK={ex['_meta']['token_count']}")
        preview_lines.append("=" * 80)
        preview_lines.append("--- USER ---")
        u = ex["messages"][0]["content"]
        preview_lines.append(u[:600] + ("\n...[truncated]..." if len(u) > 600 else ""))
        preview_lines.append("\n--- ASSISTANT ---")
        a = ex["messages"][1]["content"]
        preview_lines.append(a[:600] + ("\n...[truncated]..." if len(a) > 600 else ""))
        preview_lines.append("")
    (OUT_DIR / "preview.txt").write_text("\n".join(preview_lines), encoding="utf-8")

    print(f"\n{'=' * 60}")
    print("DATASET STATS")
    print(f"{'=' * 60}")
    print(f"  Total examples: {stats['n_examples']}")
    print(f"  Token count: min={stats['token_count_min']}  "
          f"max={stats['token_count_max']}  "
          f"mean={stats['token_count_mean']}")
    print(f"  By graph:")
    for g, n in sorted(by_graph.items()):
        print(f"    {g:24s} {n}")
    print(f"  By round:")
    for r, n in sorted(by_round.items()):
        print(f"    {r:24s} {n}")
    print(f"  Skipped graphs: {sorted(SKIP_GRAPHS)}")
    print()
    print(f"Output files:")
    print(f"  {OUT_DIR / 'train.jsonl'}")
    print(f"  {OUT_DIR / 'stats.json'}")
    print(f"  {OUT_DIR / 'preview.txt'}")


if __name__ == "__main__":
    main()
