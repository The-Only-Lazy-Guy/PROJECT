"""
Build a v3.5 prompt with the graph context filtered to question-relevant
nodes only. For small graphs (~10-20 nodes) the filter is a no-op; for
large graphs (cs4 with 82 nodes) it cuts the prompt by 3-5x.

Filter rule:
  1. Use retrieve_anchors_v2 to find the top-K most relevant nodes by
     question similarity.
  2. Expand the kept set by `hop` hops along ANY edge (treating graph as
     undirected for the expansion only) — keeps supporting context.
  3. Emit the filtered subgraph in the same V1 atomic-node format
     used by build_v35_prompt's full version.
"""
from __future__ import annotations

import json
from pathlib import Path

from anchor_retrieval import retrieve_anchors_v2
from graph_core import MemoryGraph


def filter_graph_by_question(
    graph_path: str,
    question: str,
    *,
    k_anchors: int = 12,
    hop: int = 1,
) -> tuple[list[dict], list[dict], dict]:
    """Return (kept_nodes, kept_edges, diagnostics) for the filtered subgraph."""
    raw = json.loads(Path(graph_path).read_text(encoding="utf-8"))
    nodes_by_id = {n["id"]: n for n in raw["nodes"]}
    edges = raw["edges"]

    graph = MemoryGraph.load_json(graph_path)
    graph_basename = Path(graph_path).stem
    try:
        anchors = list(retrieve_anchors_v2(
            question, graph, k=k_anchors,
            strategy="topk", graph_basename=graph_basename,
        ))
    except Exception:
        # Fallback: take any k node ids
        anchors = list(nodes_by_id.keys())[:k_anchors]

    kept = set(anchors)
    for _ in range(hop):
        new_kept = set(kept)
        for e in edges:
            if e["src"] in kept:
                new_kept.add(e["dst"])
            if e["dst"] in kept:
                new_kept.add(e["src"])
        kept = new_kept

    kept_nodes = [n for n in raw["nodes"] if n["id"] in kept]
    kept_edges = [e for e in edges if e["src"] in kept and e["dst"] in kept]

    diag = {
        "graph_total_nodes": len(raw["nodes"]),
        "graph_total_edges": len(edges),
        "kept_nodes": len(kept_nodes),
        "kept_edges": len(kept_edges),
        "anchor_count": len(anchors),
        "hop_depth": hop,
        "node_keep_ratio": round(len(kept_nodes) / len(raw["nodes"]), 3),
    }
    return kept_nodes, kept_edges, diag


def format_filtered_graph_context(kept_nodes: list[dict], kept_edges: list[dict]) -> str:
    """Same atomic-node format used by build_v35_prompt, but on a subset."""
    lines = ["# Reference material", "", "## Facts", ""]
    for node in kept_nodes:
        lines.append(f"### [{node['id']}] type={node['node_type']}")
        lines.append(str(node.get("text", "")).strip())
        lines.append("")
    lines.append("## Relationships")
    for edge in kept_edges:
        lines.append(f"- {edge['src']} --[{edge['relation']}]--> {edge['dst']}")
    return "\n".join(lines).strip()


def build_v35_prompt_filtered(
    question: str,
    graph_path: str,
    *,
    k_anchors: int = 12,
    hop: int = 1,
    inject_hypothesis_pool: bool = False,
) -> tuple[str, dict]:
    """Returns (prompt, diagnostics).

    When `inject_hypothesis_pool=True`, the per-graph hypothesis pool
    (built by `_hypothesis_pool.py` from prior reasoning traces) is
    rendered as an additional context section after the graph and before
    the instructions. The model sees these as candidate ideas from
    earlier reasoners but should NOT treat them as canonical graph
    facts. This is how the graph effectively grows: hypotheses cited
    across enough independent sessions earn promotion.
    """
    from pathlib import Path as _Path
    kept_nodes, kept_edges, diag = filter_graph_by_question(
        graph_path, question, k_anchors=k_anchors, hop=hop,
    )
    ctx = format_filtered_graph_context(kept_nodes, kept_edges)

    pool_section = ""
    if inject_hypothesis_pool:
        from _hypothesis_pool import format_hypotheses_for_prompt
        graph_id = _Path(graph_path).stem
        pool_section = format_hypotheses_for_prompt(graph_id)
        if pool_section:
            pool_section = f"\n\n{pool_section}"
            diag["hypothesis_pool_chars"] = len(pool_section)
        else:
            diag["hypothesis_pool_chars"] = 0

    prompt = (
        f"{ctx}{pool_section}\n\n"
        "---\n\n"
        "Above is a body of internal reference material you have absorbed. The user does NOT see this material and does NOT know it exists. Treat it as latent knowledge — use it when it is relevant, ignore it when it is not. Your job is to answer the user as if you were a domain expert who happens to have this background.\n\n"
        "Emit your response in exactly TWO blocks, in this order:\n\n"
        "<reasoning>\n"
        "GOAL: <restate the user's question in one line>\n\n"
        "KNOWN: list facts, formulas, code templates, or constraints from your absorbed knowledge that bear on this question. Paraphrase in your own words; never quote internal identifiers. If your absorbed knowledge does not cover this topic, write 'absorbed knowledge does not cover this directly' and proceed to UNKNOWN/HYPOTHESES.\n"
        "- <fact 1>\n"
        "- <fact 2>\n\n"
        "UNKNOWN: list what the question requires that your absorbed knowledge does not supply. If KNOWN already covers everything, write 'none'.\n"
        "- <thing 1>\n\n"
        "HYPOTHESES: your best-effort answer ideas. You MUST populate this section with substantive proposals — drawn from general principles, analogous cases, or domain reasoning — even when KNOWN is sparse or empty. These are inventions, but principled ones.\n"
        "- <hypothesis 1, with one-line justification>\n\n"
        "PLAN: how you will compose the final answer (2-4 lines).\n"
        "</reasoning>\n\n"
        "<answer>\n"
        "... natural-language answer for the user ...\n"
        "</answer>\n\n"
        "ABSOLUTE RULES — do not break these:\n"
        "1. ALWAYS attempt the question. NEVER refuse. NEVER say 'I cannot answer', 'insufficient information', 'no relevant nodes', 'the available material does not cover', or anything similar. If your absorbed knowledge is sparse on the topic, still give your best reasoned answer drawn from general principles. The user expects an answer.\n"
        "2. NEVER mention 'the knowledge graph', 'the context', 'the reference', 'the nodes', 'the absorbed material', 'the anchors', 'KNOWN', 'UNKNOWN', 'HYPOTHESIS', or any phrase that hints at internal structure. The user does not know any of this exists.\n"
        "3. NEVER include node identifiers, source tags, citation markers like '[some_id]' or '(source: ...)', or any provenance annotations.\n"
        "4. If your absorbed knowledge contains code relevant to the answer, copy it VERBATIM into <answer> inside a fenced code block. The user wants working code, not a description.\n"
        "5. If absorbed knowledge contradicts a relevant misconception, refute the misconception as natural commentary — never say 'the reference says' — just state the correct view and why the wrong one is wrong.\n"
        "6. Where <reasoning> uses a HYPOTHESIS to fill a gap, in <answer> phrase it as natural reasoning ('a common approach is...', 'one reasonable way is...', 'this assumes...'). Never say 'HYPOTHESIS' or 'I am inventing this' inside <answer>.\n"
        "7. The <answer> block must read as polished prose from a domain expert. The <reasoning> block can be terse and structured.\n\n"
        "Do not emit any tokens before <reasoning> or after </answer>. Do not include hidden chain-of-thought outside these two blocks.\n\n"
        f"Question: {question}"
    )
    return prompt, diag


def build_v35_prompt_short(
    question: str,
    graph_path: str,
    *,
    k_anchors: int = 12,
    hop: int = 1,
) -> tuple[str, dict]:
    """Minimal-directive variant of the v3.5 prompt. Same anchor-filtered
    graph context, but the directive is stripped down to ~3 lines.

    Purpose: probe whether SFT actually internalized the v3.5 structure
    (KNOWN / UNKNOWN / HYPOTHESES / PLAN, leak avoidance, attempt-always
    behavior) into the weights, or whether the 60-line directive is doing
    all the work at inference. If the trained model preserves the format
    and leak hygiene under this short prompt while baseline degrades,
    SFT has real ergonomic value — shorter prompts at inference time.
    """
    kept_nodes, kept_edges, diag = filter_graph_by_question(
        graph_path, question, k_anchors=k_anchors, hop=hop,
    )
    ctx = format_filtered_graph_context(kept_nodes, kept_edges)

    prompt = (
        f"{ctx}\n\n"
        "---\n\n"
        "You have absorbed the material above. The user does not know it exists.\n"
        "Emit your response in two blocks: <reasoning>...</reasoning><answer>...</answer>. "
        "The answer should read as polished prose; never mention the source or any internal structure.\n\n"
        f"Question: {question}"
    )
    return prompt, diag
