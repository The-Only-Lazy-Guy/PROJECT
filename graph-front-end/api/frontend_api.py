from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import uuid
import threading
import asyncio
from collections import Counter
from pathlib import Path
from queue import Queue
from typing import Any, Callable, Dict, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = APP_DIR.parent
DEFAULT_BACKEND_DIR = PROJECT_DIR / "graph_v5"
LEGACY_BACKEND_DIR = PROJECT_DIR / "graph_final"

BACKEND_DIR = Path(
    os.environ.get("GRAPH_BACKEND_DIR", str(DEFAULT_BACKEND_DIR))
).expanduser().resolve()
if not BACKEND_DIR.exists() and LEGACY_BACKEND_DIR.exists():
    BACKEND_DIR = LEGACY_BACKEND_DIR.resolve()
GRAPH_DIR = Path(
    os.environ.get("GRAPH_GRAPH_DIR", str(BACKEND_DIR / "graphs"))
).expanduser().resolve()
CORPUS_ROOT = Path(
    os.environ.get("GRAPH_CORPUS_ROOT", str(BACKEND_DIR / "data" / "distillation_corpus"))
).expanduser().resolve()
CORPUS_FILE = os.environ.get("GRAPH_CORPUS_FILE", "sessions.jsonl")
ARTIFACT_DIR = APP_DIR / "artifacts"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if LEGACY_BACKEND_DIR.exists() and str(LEGACY_BACKEND_DIR) not in sys.path:
    # Legacy mode still uses graph_final's prompt builder; keep it behind graph_v5.
    sys.path.append(str(LEGACY_BACKEND_DIR))

os.environ.setdefault("HF_HOME", str(BACKEND_DIR / "cache"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
CORPUS_ROOT.mkdir(parents=True, exist_ok=True)

from anchor_retrieval import retrieve_anchors_v2  # noqa: E402
from graph_core import MemoryGraph, canonical_relation  # noqa: E402
from _anchor_filtered_prompt import build_v35_prompt_filtered  # noqa: E402
from reasoning.budgets import Budgets  # noqa: E402
from reasoning.reasoning_loop import ReasoningRequest, ReasoningResult, run_reasoning  # noqa: E402
from answerer_v4 import answer_query_v4, V4OpencodeController  # noqa: E402
from reasoning.task_classifier import TaskClassifier  # noqa: E402

_CLASSIFIER = TaskClassifier.load()  # loads trained MLP or falls back to rules


MODEL_COMMAND = os.environ.get("MODEL_COMMAND") or os.environ.get("OPENCODE_COMMAND", "opencode")
MODEL_ATTACH_URL = os.environ.get("MODEL_ATTACH_URL") or os.environ.get("OPENCODE_ATTACH_URL", "http://localhost:6767")
MODEL_TIMEOUT = float(os.environ.get("MODEL_TIMEOUT") or os.environ.get("OPENCODE_TIMEOUT", "240"))

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_HEADER_RE = re.compile(r"^\s*>\s*build\s*.*$", re.MULTILINE)
_REASONING_BLOCK_RE = re.compile(r"<reasoning>(.*?)</reasoning>", re.DOTALL | re.IGNORECASE)
_ANSWER_BLOCK_RE = re.compile(r"<answer>(.*?)</answer>", re.DOTALL | re.IGNORECASE)


def _reasoning_mode() -> Literal["legacy", "substrate", "v4"]:
    mode = str(os.environ.get("REASONING_MODE", "v4")).strip().lower()
    if mode == "v4":
        return "v4"
    if mode == "substrate":
        return "substrate"
    return "legacy"


def _corpus_path() -> Path:
    return CORPUS_ROOT / CORPUS_FILE


def _session_subgraph_root() -> Path:
    raw = os.environ.get("REASONING_SESSION_PERSIST_ROOT", "").strip()
    if raw:
        return Path(raw)
    return BACKEND_DIR / "data" / "session_subgraphs"


def _split_reasoning_and_answer(content: str) -> tuple[str, str]:
    """Split the model output into (reasoning_trace, answer).

    Expects the v3.5 dual-block format:
        <reasoning>...</reasoning>
        <answer>...</answer>

    Graceful fallback: if the tags are absent, treat the whole response
    as the answer and emit an empty reasoning trace. The frontend will
    then surface 'no reasoning trace produced' rather than crash.
    """
    text = content or ""
    rm = _REASONING_BLOCK_RE.search(text)
    am = _ANSWER_BLOCK_RE.search(text)
    reasoning = rm.group(1).strip() if rm else ""
    answer = am.group(1).strip() if am else text.strip()
    return reasoning, answer

app = FastAPI(title="Graph-Agent Frontend API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    graph_id: str = Field(..., min_length=1, max_length=128)
    k_anchors: int = Field(12, ge=3, le=24)
    anchor_strategy: Literal["topk", "mmr", "legacy"] = "topk"
    use_failure_boost: bool = True
    enable_plan_tree: bool = False
    enable_procedures: bool = False
    enable_activation: bool = True
    max_steps: int = Field(20, ge=3, le=60)


EmitFn = Callable[[str, Dict[str, Any]], None]


def _json_error(status_code: int, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"message": message})


def _graph_paths() -> Dict[str, Path]:
    if not GRAPH_DIR.exists():
        return {}
    return {path.stem: path.resolve() for path in sorted(GRAPH_DIR.glob("*.json"))}


def _find_graph(graph_id: str) -> Path:
    paths = _graph_paths()
    path = paths.get(graph_id)
    if path is None:
        raise _json_error(404, f"Unknown graph_id {graph_id!r}")
    try:
        path.relative_to(GRAPH_DIR.resolve())
    except ValueError:
        raise _json_error(400, "Graph path escaped graph directory")
    return path


def _public_runtime_error(message: str) -> str:
    return re.sub(r"opencode", "model runtime", str(message), flags=re.IGNORECASE)


def _probe_model_runtime(timeout: float = 5.0) -> Dict[str, Any]:
    started = time.perf_counter()
    cmd = subprocess.list2cmdline([MODEL_COMMAND, "--version"])
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=True,
            encoding="utf-8",
            errors="replace",
        )
        output = (proc.stdout or proc.stderr or "").strip()
        return {
            "ok": proc.returncode == 0,
            "status_code": proc.returncode,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "version": _public_runtime_error(output[:300]),
            "error": None if proc.returncode == 0 else _public_runtime_error(proc.stderr or proc.stdout or "model runtime exited non-zero"),
        }
    except Exception as exc:
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "error": _public_runtime_error(str(exc)),
        }


def _strip_model_chrome(raw: str) -> str:
    text = _ANSI_RE.sub("", raw or "")
    text = _HEADER_RE.sub("", text, count=1)
    return text.strip()


def _model_command() -> str:
    parts = [MODEL_COMMAND, "run"]
    if MODEL_ATTACH_URL:
        parts.extend(["--attach", MODEL_ATTACH_URL])
    parts.append("-")
    return subprocess.list2cmdline(parts)


def _call_model(prompt: str, *, timeout: float = MODEL_TIMEOUT) -> Dict[str, Any]:
    started = time.perf_counter()
    proc = subprocess.run(
        _model_command(),
        cwd=str(BACKEND_DIR),
        input=prompt,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=True,
        encoding="utf-8",
        errors="replace",
    )
    elapsed = time.perf_counter() - started
    answer = _strip_model_chrome(proc.stdout)
    stderr = _strip_model_chrome(proc.stderr)
    if proc.returncode != 0:
        detail = stderr or answer or f"model runtime exited with code {proc.returncode}"
        raise RuntimeError(_public_runtime_error(detail[:2000]))
    return {
        "answer": answer,
        "stderr": stderr,
        "returncode": proc.returncode,
        "elapsed": elapsed,
    }


def _call_model_text(prompt: str, *, timeout: float = MODEL_TIMEOUT) -> str:
    return str(_call_model(prompt, timeout=timeout)["answer"])


def _graph_summary(path: Path) -> Dict[str, Any]:
    graph = MemoryGraph.load_json(str(path))
    node_types = Counter(node.node_type for node in graph.nodes.values())
    edge_relations = Counter(canonical_relation(edge.relation) for edge in graph.edges)
    return {
        "id": path.stem,
        "file": path.name,
        "nodes": len(graph.nodes),
        "edges": len(graph.edges),
        "node_types": dict(node_types),
        "edge_relations": dict(edge_relations),
    }


def _retrieve_anchors(question: str, graph: MemoryGraph, req: RunRequest, graph_basename: str) -> list[str]:
    strategy = req.anchor_strategy if req.anchor_strategy in {"topk", "mmr"} else "topk"
    try:
        return list(
            retrieve_anchors_v2(
                question,
                graph,
                k=req.k_anchors,
                strategy=strategy,
                graph_basename=graph_basename,
            )
        )
    except Exception:
        return list(graph.nodes.keys())[: req.k_anchors]


def _build_prompt(req: RunRequest, graph_path: Path, graph: MemoryGraph, anchors: list[str]) -> str:
    prompt, _diag = build_v35_prompt_filtered(
        req.question,
        str(graph_path),
        k_anchors=req.k_anchors,
        hop=1,
        inject_hypothesis_pool=False,
    )
    return prompt


def _session_from_model(
    *,
    req: RunRequest,
    graph: MemoryGraph,
    anchors: list[str],
    answer: str,
) -> Dict[str, Any]:
    nodes: Dict[str, Any] = {
        "Q0": {
            "id": "Q0",
            "text": req.question,
            "node_type": "question",
            "source_memory_id": None,
            "confidence": 1.0,
            "relevance": 1.0,
            "metadata": {"provider": "model"},
            "created_step": 0,
        },
        "A0": {
            "id": "A0",
            "text": answer,
            "node_type": "conclusion",
            "source_memory_id": None,
            "confidence": 1.0,
            "relevance": 1.0,
            "metadata": {"provider": "model"},
            "created_step": 2,
        },
    }
    edges = []
    for node_id in anchors:
        node = graph.nodes.get(node_id)
        if node is None:
            continue
        nodes[node_id] = {
            "id": node_id,
            "text": node.text,
            "node_type": "evidence",
            "source_memory_id": node_id,
            "confidence": 1.0,
            "relevance": 1.0,
            "metadata": {"memory_node_type": node.node_type},
            "created_step": 1,
        }
        edges.append({
            "src": node_id,
            "dst": "A0",
            "relation": "support",
            "status": "context",
            "confidence": 1.0,
            "created_step": 2,
            "metadata": {"provider": "model"},
        })
    return {
        "question": req.question,
        "step": 2,
        "nodes": nodes,
        "edges": edges,
        "paths": {},
        "frontier": [],
    }


def _session_from_anchors(
    *,
    req: RunRequest,
    graph: MemoryGraph,
    anchors: list[str],
) -> Dict[str, Any]:
    nodes: Dict[str, Any] = {
        "Q0": {
            "id": "Q0",
            "text": req.question,
            "node_type": "question",
            "source_memory_id": None,
            "confidence": 1.0,
            "relevance": 1.0,
            "metadata": {"provider": "model"},
            "created_step": 0,
        },
    }
    edges = []
    for node_id in anchors:
        node = graph.nodes.get(node_id)
        if node is None:
            continue
        nodes[node_id] = {
            "id": node_id,
            "text": node.text,
            "node_type": "evidence",
            "source_memory_id": node_id,
            "confidence": 1.0,
            "relevance": 1.0,
            "metadata": {"memory_node_type": node.node_type},
            "created_step": 1,
        }
        edges.append({
            "src": "Q0",
            "dst": node_id,
            "relation": "retrieved",
            "status": "live",
            "confidence": 1.0,
            "created_step": 1,
            "metadata": {"provider": "model"},
        })
    return {
        "question": req.question,
        "step": 1,
        "nodes": nodes,
        "edges": edges,
        "paths": {},
        "frontier": [],
    }


def _legacy_session_event_payload(
    *,
    session: Dict[str, Any],
    stage: str,
    iteration: int = 0,
    **extra: Any,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "stage": stage,
        "iteration": iteration,
        "session_subgraph": session,
        "node_count": len(session.get("nodes", {})),
        "edge_count": len(session.get("edges", [])),
        "audit_count": 0,
        "step_count": session.get("step", iteration),
    }
    payload.update(extra)
    return payload


def _metrics(session: Dict[str, Any], elapsed: float, prompt_chars: int, answer: str) -> Dict[str, Any]:
    return {
        "steps": 1,
        "confidence": 1.0,
        "nodes": len(session["nodes"]),
        "edges": len(session["edges"]),
        "paths": 0,
        "failures": 0,
        "elapsed_seconds": round(elapsed, 2),
        "usage_coverage": None,
        "usage_pairs": 0,
        "usage_weak": 0,
        "plan_coverage": None,
        "anchor_quality": None,
        "anchor_count": max(0, len(session["nodes"]) - 2),
        "prompt_chars": prompt_chars,
        "answer_chars": len(answer or ""),
    }


def _metrics_from_reasoning(result: ReasoningResult, elapsed: float) -> Dict[str, Any]:
    failures = sum(1 for outcome in result.dispatch_outcomes if outcome.error)
    return {
        "steps": result.iterations_completed,
        "confidence": 0.55 if result.early_terminated_reason else 0.85,
        "nodes": len(result.session_subgraph.nodes),
        "edges": len(result.session_subgraph.edges),
        "paths": 0,
        "failures": failures,
        "elapsed_seconds": round(elapsed, 2),
        "usage_coverage": None,
        "usage_pairs": 0,
        "usage_weak": 0,
        "plan_coverage": None,
        "anchor_quality": None,
        "anchor_count": len(result.anchor_ids),
        "prompt_chars": 0,
        "answer_chars": len(result.answer or ""),
    }


def _compact_json(value: Any, limit: int = 220) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _reasoning_node_text(node_data: Dict[str, Any]) -> str:
    node_type = str(node_data.get("node_type", "unknown"))
    if node_type == "session_object":
        state = node_data.get("state", {}) or {}
        parts = [f"{key}={_compact_json(value)}" for key, value in state.items()]
        return f"{node_data.get('name', node_data.get('id', 'session_object'))}: {'; '.join(parts) if parts else 'empty state'}"
    if node_type == "procedure":
        purpose = str(node_data.get("purpose", "")).strip()
        when = str(node_data.get("when_to_use", "")).strip()
        return f"{purpose}\n{when}".strip()
    if node_type == "failure_pattern":
        attempted = str(node_data.get("attempted_approach", "")).strip()
        condition = str(node_data.get("failure_condition", "")).strip()
        mechanism = str(node_data.get("failure_mechanism", "")).strip()
        return f"{attempted}\nFails when: {condition}\nWhy: {mechanism}".strip()
    return str(node_data.get("text", _compact_json(node_data)))


def _reasoning_session(result: ReasoningResult) -> Dict[str, Any]:
    nodes: Dict[str, Any] = {}
    for node_id, node_data in result.session_subgraph.nodes.items():
        node_type = str(node_data.get("node_type", "unknown"))
        nodes[node_id] = {
            "id": node_id,
            "text": _reasoning_node_text(node_data),
            "node_type": node_type,
            "source_memory_id": node_data.get("procedure_id"),
            "confidence": 0.85 if node_type == "session_object" else 0.8,
            "relevance": 1.0,
            "metadata": {
                "provider": "substrate",
                "provenance": node_data.get("provenance"),
                "state": node_data.get("state"),
            },
            "created_step": int(node_data.get("created_step", 0)),
        }
    edges = [
        {
            "src": edge.src,
            "dst": edge.dst,
            "relation": edge.relation,
            "status": str(edge.metadata.get("status", "verified")),
            "confidence": float(edge.metadata.get("confidence", 0.85)),
            "created_step": int(edge.metadata.get("created_step", 0)),
            "metadata": {"provider": "substrate", **dict(edge.metadata)},
        }
        for edge in result.session_subgraph.edges
    ]
    return {
        "question": result.session_subgraph.query,
        "step": result.session_subgraph.step_count,
        "nodes": nodes,
        "edges": edges,
        "paths": {},
        "frontier": [],
    }


def _trace_from_reasoning(result: ReasoningResult) -> list[Dict[str, Any]]:
    trace: list[Dict[str, Any]] = [
        {
            "step": 0,
            "phase": "retrieve",
            "action": "RETRIEVE_ANCHORS",
            "args": {"anchors": result.anchor_ids, "count": len(result.anchor_ids)},
            "thought": "Retrieve anchor nodes with failure-pattern weighting before reasoning.",
            "result": {"success": True, "summary": f"{len(result.anchor_ids)} anchors retrieved"},
        }
    ]

    for iteration, raw in enumerate(result.raw_outputs, start=1):
        reasoning_trace, answer = _split_reasoning_and_answer(raw)
        trace.append({
            "step": iteration,
            "phase": "reason",
            "action": "MODEL_RUN",
            "args": {"mode": "substrate"},
            "thought": "Run one reasoning-loop iteration.",
            "result": {
                "success": True,
                "summary": f"Iteration {iteration} produced {len(raw)} characters",
                "reasoning_trace_chars": len(reasoning_trace),
                "answer_chars": len(answer),
                "reasoning_trace": reasoning_trace,
                "answer": answer,
                "raw_output": raw,
            },
        })

    for offset, outcome in enumerate(result.dispatch_outcomes, start=1):
        trace.append({
            "step": offset,
            "phase": "dispatch",
            "action": "INVOKE_PROCEDURE",
            "args": {
                "procedure_name": outcome.match.procedure_name,
                "args_text": outcome.match.args_text,
                "object_id": outcome.object_id,
            },
            "thought": f"Dispatch {outcome.match.procedure_name} from free-text reasoning.",
            "result": {
                "success": outcome.error is None,
                "summary": outcome.error or f"{outcome.mutations_applied} mutations applied",
                "mutations_applied": outcome.mutations_applied,
            },
        })

    trace.append({
        "step": result.iterations_completed,
        "phase": "finalize",
        "action": "FINALIZE_ANSWER",
        "args": {"reasoning_mode": "substrate"},
        "thought": "Finalize the user-facing answer from the reasoning loop state.",
        "result": {
            "success": bool((result.answer or "").strip()),
            "summary": result.early_terminated_reason or "Answer extracted from substrate run",
        },
    })
    return trace


def _run_payload(
    *,
    run_id: str,
    req: RunRequest,
    graph_path: Path,
    graph: MemoryGraph,
    anchors: list[str],
    answer: str,
    reasoning_trace: str = "",
    elapsed: float,
    prompt_chars: int,
    stderr: str = "",
) -> Dict[str, Any]:
    session = _session_from_model(req=req, graph=graph, anchors=anchors, answer=answer)
    trace = [
        {
            "step": 0,
            "phase": "prompt",
            "action": "BUILD_GRAPH_PROMPT",
            "args": {"anchors": anchors, "prompt_chars": prompt_chars},
            "thought": "Build a graph-grounded prompt from the selected graph.",
            "result": {"success": True, "summary": f"{len(anchors)} anchors included"},
        },
        {
            "step": 1,
            "phase": "generate",
            "action": "MODEL_RUN",
            "args": {"runtime": "configured"},
            "thought": "Ask the model runtime to answer from the graph context.",
            "result": {
                "success": True,
                "summary": f"Model returned {len(answer or '')} characters",
                "reasoning_trace_chars": len(reasoning_trace or ""),
                "stderr": _public_runtime_error(stderr[:1000]) if stderr else None,
            },
        },
    ]
    return {
        "run_id": run_id,
        "question": req.question,
        "graph_id": req.graph_id,
        "graph_file": graph_path.name,
        "answer": answer,
        "reasoning_trace": reasoning_trace,
        "confidence": 1.0,
        "steps_taken": 1,
        "elapsed": round(elapsed, 2),
        "packet": {
            "question": req.question,
            "answer": answer,
            "reasoning_trace": reasoning_trace,
            "confidence": 1.0,
            "answer_type": "graph_context",
            "anchors": anchors,
            "prompt_chars": prompt_chars,
        },
        "trace": trace,
        "session": session,
        "metrics": _metrics(session, elapsed, prompt_chars, answer),
    }


def _run_payload_from_reasoning(
    *,
    run_id: str,
    req: RunRequest,
    graph_path: Path,
    result: ReasoningResult,
    elapsed: float,
) -> Dict[str, Any]:
    session = _reasoning_session(result)
    trace = _trace_from_reasoning(result)
    confidence = 0.55 if result.early_terminated_reason else 0.85
    return {
        "run_id": run_id,
        "question": req.question,
        "graph_id": req.graph_id,
        "graph_file": graph_path.name,
        "answer": result.answer,
        "reasoning_trace": result.reasoning_trace,
        "confidence": confidence,
        "steps_taken": result.iterations_completed,
        "elapsed": round(elapsed, 2),
        "packet": {
            "question": req.question,
            "answer": result.answer,
            "reasoning_trace": result.reasoning_trace,
            "confidence": confidence,
            "answer_type": "reasoning_substrate",
            "anchors": result.anchor_ids,
            "prompt_chars": 0,
            "iterations_completed": result.iterations_completed,
            "session_subgraph_path": str(result.session_subgraph_path),
            "early_terminated_reason": result.early_terminated_reason,
        },
        "trace": trace,
        "session": session,
        "metrics": _metrics_from_reasoning(result, elapsed),
        "substrate": {
            "audit_summary": result.audit_summary,
            "budget_usage": result.budget_usage,
            "consolidation_decisions": [
                {
                    "node_id": d.node_id,
                    "node_type": d.node_type,
                    "decision": d.decision,
                    "reason": d.reason,
                    "gate_results": d.gate_results,
                }
                for d in result.consolidation_decisions
            ],
            "session_subgraph_path": str(result.session_subgraph_path),
            "session_subgraph": result.session_subgraph.to_dict(),
        },
    }


def _run_graph_agent(req: RunRequest, emit: Optional[EmitFn] = None) -> Dict[str, Any]:
    mode = _reasoning_mode()
    if mode == "v4":
        return _run_graph_agent_v4(req, emit=emit)
    if mode == "substrate":
        return _run_graph_agent_substrate(req, emit=emit)
    return _run_graph_agent_legacy(req, emit=emit)


def _run_graph_agent_legacy(req: RunRequest, emit: Optional[EmitFn] = None) -> Dict[str, Any]:
    graph_path = _find_graph(req.graph_id)
    graph = MemoryGraph.load_json(str(graph_path))
    anchors = _retrieve_anchors(req.question, graph, req, graph_path.stem)
    prompt = _build_prompt(req, graph_path, graph, anchors)
    run_id = uuid.uuid4().hex[:12]
    if emit:
        emit("started", {"run_id": run_id, "graph_id": req.graph_id})
        emit("session_graph", _legacy_session_event_payload(
            session=_session_from_anchors(req=req, graph=graph, anchors=anchors),
            stage="anchors_retrieved",
            iteration=0,
            anchor_count=len(anchors),
        ))
        emit("action_start", {"action": "MODEL_RUN", "prompt_chars": len(prompt)})

    result = _call_model(prompt)
    raw_content = result["answer"]
    reasoning_trace, answer = _split_reasoning_and_answer(raw_content)
    elapsed = float(result["elapsed"])
    if emit:
        emit("action_complete", {
            "action": "MODEL_RUN",
            "content": answer,
            "reasoning_trace_chars": len(reasoning_trace),
        })
        emit("session_graph", _legacy_session_event_payload(
            session=_session_from_model(req=req, graph=graph, anchors=anchors, answer=answer),
            stage="answer_ready",
            iteration=1,
            anchor_count=len(anchors),
        ))

    return _run_payload(
        run_id=run_id,
        req=req,
        graph_path=graph_path,
        graph=graph,
        anchors=anchors,
        answer=answer,
        reasoning_trace=reasoning_trace,
        elapsed=elapsed,
        prompt_chars=len(prompt),
        stderr=result.get("stderr", ""),
    )


def _run_graph_agent_substrate(req: RunRequest, emit: Optional[EmitFn] = None) -> Dict[str, Any]:
    graph_path = _find_graph(req.graph_id)
    run_id = uuid.uuid4().hex[:12]
    if emit:
        emit("started", {"run_id": run_id, "graph_id": req.graph_id, "reasoning_mode": "substrate"})
        emit("action_start", {"action": "REASONING_RUN", "reasoning_mode": "substrate"})

    started = time.perf_counter()
    result = run_reasoning(
        ReasoningRequest(
            question=req.question,
            graph_id=req.graph_id,
            graph_path=str(graph_path),
            k_anchors=req.k_anchors,
            max_iterations=int(os.environ.get("REASONING_MAX_ITERATIONS", "3")),
            session_persist_root=_session_subgraph_root(),
            budgets=Budgets(
                max_llm_calls=int(os.environ.get("REASONING_MAX_LLM_CALLS", "6")),
                max_total_tokens=int(os.environ.get("REASONING_MAX_TOTAL_TOKENS", "4096")),
            ),
        ),
        llm_call=lambda prompt: _call_model_text(prompt),
        event_callback=(lambda event, data: emit(event, data)) if emit else None,
    )
    elapsed = time.perf_counter() - started

    if emit:
        emit("action_complete", {
            "action": "REASONING_RUN",
            "content": result.answer,
            "reasoning_trace_chars": len(result.reasoning_trace or ""),
            "dispatch_count": len(result.dispatch_outcomes),
        })
        for outcome in result.dispatch_outcomes:
            emit("tool_result", {
                "action": "INVOKE_PROCEDURE",
                "procedure_name": outcome.match.procedure_name,
                "mutations_applied": outcome.mutations_applied,
                "success": outcome.error is None,
                "error": outcome.error,
            })

    return _run_payload_from_reasoning(
        run_id=run_id,
        req=req,
        graph_path=graph_path,
        result=result,
        elapsed=elapsed,
    )


def _run_graph_agent_v4(req: RunRequest, emit: Optional[EmitFn] = None) -> Dict[str, Any]:
    import traceback as _tb
    _dbg = lambda msg: print(f"[v4-debug] {msg}", flush=True)
    _dbg(f"starting: q={req.question[:60]!r} graph={req.graph_id}")

    try:
        graph_path = _find_graph(req.graph_id)
    except Exception as e:
        _dbg(f"graph lookup FAILED: {e}")
        raise
    _dbg(f"graph found: {graph_path}")

    graph = MemoryGraph.load_json(str(graph_path))
    _dbg(f"graph loaded: {len(graph.nodes)} nodes")
    run_id = uuid.uuid4().hex[:12]

    if emit:
        emit("started", {"run_id": run_id, "graph_id": req.graph_id, "reasoning_mode": "v4"})
        emit("action_start", {"action": "V4_REASONING_RUN", "reasoning_mode": "v4"})

    _dbg("creating V4OpencodeController...")
    controller = V4OpencodeController(
        model=os.environ.get("V4_MODEL", "opencode/big-pickle"),
        server_url=os.environ.get("OPENCODE_SERVE_URL", "http://127.0.0.1:4096"),
        config_dir=os.environ.get("OPENCODE_CONFIG_DIR", r"C:\Users\Ace\AppData\Local\Temp\opencode-empty-config"),
        timeout=MODEL_TIMEOUT,
    )
    _dbg("controller created OK")

    # Phase 17: auto-configure pipeline based on question complexity.
    auto_config = os.environ.get("V4_AUTO_CONFIG", "1").strip() not in ("0", "false", "no")
    v4_kwargs: Dict[str, Any] = {
        "question": req.question,
        "graph": graph,
        "controller": controller,
        "max_steps": req.max_steps,
        "k_anchors": req.k_anchors,
        "use_failure_boost": req.use_failure_boost,
        "enable_activation": req.enable_activation,
        "graph_id": req.graph_id,
        "enable_plan_tree": req.enable_plan_tree,
        "enable_procedures": req.enable_procedures,
        "collect_corpus": True,
        "corpus_root": CORPUS_ROOT,
        "corpus_file": CORPUS_FILE,
        "corpus_extra_metadata": {
            "source": "frontend_demo",
            "frontend_run_id": run_id,
            "backend_dir": str(BACKEND_DIR),
        },
        "session_root": _session_subgraph_root(),
        "signature_stats_dir": BACKEND_DIR / "data" / "signature_stats",
        "controller_label": os.environ.get("V4_MODEL", "opencode/big-pickle"),
    }
    if auto_config:
        v4_kwargs["auto_config"] = True
        v4_kwargs["classifier"] = _CLASSIFIER

    _dbg(f"calling answer_query_v4 (auto_config={auto_config})...")
    if emit:
        emit("log", {"message": f"Classified as: {_CLASSIFIER.classify(req.question)[0] if auto_config else 'manual'}"})
        emit("log", {"message": f"Collecting finalized V4 demo rows at: {_corpus_path()}"})
    started = time.perf_counter()
    try:
        packet = answer_query_v4(**v4_kwargs)
    except Exception as e:
        _dbg(f"answer_query_v4 CRASHED: {type(e).__name__}: {e}")
        _tb.print_exc()
        raise
    _dbg(f"answer_query_v4 done: steps={packet.steps} finalized={packet.finalized} elapsed={packet.elapsed_sec}s")
    elapsed = time.perf_counter() - started

    if emit:
        emit("action_complete", {
            "action": "V4_REASONING_RUN",
            "content": packet.answer,
            "steps": packet.steps,
            "tool_call_count": packet.tool_call_count,
        })
        for invoc in packet.procedure_invocations:
            emit("tool_result", {
                "tool_name": "invoke_procedure",
                "procedure_name": invoc.get("procedure"),
                "success": invoc.get("error") is None,
                "error": invoc.get("error"),
                "summary": f"{invoc.get('procedure')} — {invoc.get('mutations_applied', 0)} mutations",
            })

    # Build session graph from tool log
    session_nodes: Dict[str, Any] = {
        "Q0": {
            "id": "Q0", "text": req.question, "node_type": "question",
            "confidence": 1.0, "relevance": 1.0, "created_step": 0,
        },
    }
    session_edges: list[Dict[str, Any]] = []
    tool_step = 1
    for entry in packet.tool_log:
        tool_name = entry.get("name", "tool")
        args = entry.get("args", {})
        result = entry.get("result_summary", "")
        node_id = f"tool_{tool_step}"
        node_type = "note"
        if "read_node" in tool_name or "search" in tool_name or "expand" in tool_name:
            node_type = "evidence"
        elif "hypothesize" in tool_name:
            node_type = "hypothesis"
        elif "verify" in tool_name:
            node_type = "hypothesis"
        elif "failure" in tool_name:
            node_type = "failure_pattern"
        elif "object" in tool_name or "create" in tool_name or "update" in tool_name:
            node_type = "session_object"
        elif "plan" in tool_name or "mark_done" in tool_name:
            node_type = "plan_step"
        elif "invoke_procedure" in tool_name:
            node_type = "procedure"
        elif "list_anchors" in tool_name:
            node_type = "evidence"

        session_nodes[node_id] = {
            "id": node_id, "text": result, "node_type": node_type,
            "confidence": 0.85, "relevance": 0.8, "created_step": tool_step,
            "metadata": {"tool_name": tool_name, "args": args},
        }
        if tool_step > 1:
            prev_id = f"tool_{tool_step - 1}"
            rel = "calls" if tool_name in ("invoke_procedure",) else "derived_from"
            session_edges.append({
                "src": prev_id, "dst": node_id, "relation": rel,
                "status": "executed", "confidence": 0.85, "created_step": tool_step,
            })
        tool_step += 1

    # Plan subgoals as nodes
    for pi, sg in enumerate(packet.plan):
        pid = f"plan_{pi}"
        session_nodes[pid] = {
            "id": pid, "text": sg.text, "node_type": "plan",
            "confidence": 0.9, "relevance": 0.8, "created_step": 0,
            "metadata": {"done": sg.done, "index": pi},
        }
        if pi == 0:
            session_edges.append({
                "src": "Q0", "dst": pid, "relation": "refine",
                "status": "planned", "confidence": 0.9, "created_step": 0,
            })
        else:
            prev_pid = f"plan_{pi - 1}"
            session_edges.append({
                "src": prev_pid, "dst": pid, "relation": "refine",
                "status": "planned", "confidence": 0.9, "created_step": 0,
            })

    # Answer node
    session_nodes["A0"] = {
        "id": "A0", "text": packet.answer, "node_type": "answer",
        "confidence": 0.9, "relevance": 1.0, "created_step": packet.steps,
    }
    if packet.plan:
        last_plan = f"plan_{len(packet.plan) - 1}"
        session_edges.append({
            "src": last_plan, "dst": "A0", "relation": "derived_from",
            "status": "verified", "confidence": 0.9, "created_step": packet.steps,
        })

    session = {
        "question": req.question,
        "step": packet.steps,
        "nodes": session_nodes,
        "edges": session_edges,
        "paths": {},
        "frontier": [],
    }

    # Build traces from tool log
    trace: list[Dict[str, Any]] = []
    for entry in packet.tool_log:
        trace.append({
            "step": tool_call_step(trace),
            "phase": "tool",
            "action": str(entry.get("name", "tool")),
            "args": entry.get("args", {}),
            "result": {"success": True, "summary": entry.get("result_summary", "")},
        })
    cot_trace: list[Dict[str, Any]] = []
    for ci, cot in enumerate(packet.cot_log):
        cot_trace.append({
            "step": ci + 1,
            "phase": "reason",
            "action": "MODEL_RUN",
            "args": {"mode": "v4"},
            "thought": f"Step {ci + 1} reasoning",
            "result": {
                "success": True, 
                "summary": f"Step {ci + 1} produced {len(cot)} chars",
                "raw_output": cot
            },
        })
    trace = cot_trace + trace

    failures_count = len(packet.failures)

    return {
        "run_id": run_id,
        "question": req.question,
        "graph_id": req.graph_id,
        "graph_file": graph_path.name,
        "answer": packet.answer,
        "confidence": 0.85 if packet.finalized else 0.4,
        "steps_taken": packet.steps,
        "max_steps": packet.max_steps,
        "finalized": packet.finalized,
        "elapsed": round(elapsed, 2),
        "answer_raw": getattr(packet, "answer_raw", ""),
        "explanation": getattr(packet, "explanation", ""),
        "polish_applied": getattr(packet, "polish_applied", False),
        "classified_level": _CLASSIFIER.classify(req.question)[0] if auto_config else None,
        "task_frame": getattr(packet, "task_frame", None),
        "task_frame_rendered": getattr(packet, "task_frame_rendered", ""),
        "coverage": getattr(packet, "coverage", None),
        "packet": {
            "question": req.question,
            "answer": packet.answer,
            "answer_raw": getattr(packet, "answer_raw", ""),
            "explanation": getattr(packet, "explanation", ""),
            "polish_applied": getattr(packet, "polish_applied", False),
            "task_frame": getattr(packet, "task_frame", None),
            "task_frame_rendered": getattr(packet, "task_frame_rendered", ""),
            "coverage": getattr(packet, "coverage", None),
            "tool_call_count": packet.tool_call_count,
            "citation_warnings": packet.citation_warnings,
            "search_repeats": packet.search_repeats,
            "session_dir": packet.session_dir,
        },
        "trace": trace,
        "session": session,
        "metrics": {
            "steps": packet.steps,
            "confidence": 0.85 if packet.finalized else 0.4,
            "nodes": len(session_nodes),
            "edges": len(session_edges),
            "paths": 0,
            "failures": failures_count,
            "elapsed_seconds": round(elapsed, 2),
            "anchor_count": len(packet.anchors),
            "citation_warnings": packet.citation_warnings,
            "search_repeats": packet.search_repeats,
            "coverage_addressed_pct": packet.coverage_addressed_pct,
            "coverage_rounds": packet.coverage_rounds,
            "task_frame_items": packet.task_frame_items,
            "activation_signals": packet.activation_signals,
        },
        "hypotheses": packet.hypotheses,
        "plan": [{"text": sg.text, "done": sg.done} for sg in packet.plan],
        "failures": [
            {"approach": f.approach, "condition": f.condition, "mechanism": f.mechanism, "recorded_at_step": f.recorded_at_step}
            for f in packet.failures
        ],
        "plan_tree_summary": packet.plan_tree_summary,
        "meta_signals": packet.meta_signals,
        "budget_summary": packet.budget_summary,
        "procedure_invocations": packet.procedure_invocations,
        "session_dir": packet.session_dir,
        "corpus": {
            "collect_corpus": True,
            "writes_when_finalized": True,
            "backend_dir": str(BACKEND_DIR),
            "corpus_path": str(_corpus_path()),
            "session_root": str(_session_subgraph_root()),
        },
        "substrate": {
            "audit_summary": [],
            "budget_usage": packet.budget_summary,
            "session_subgraph_path": packet.session_dir,
            "consolidation_decisions": packet.consolidation_decisions,
        },
    }


def tool_call_step(trace: list) -> int:
    return len(trace) + 1


def _sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health() -> Dict[str, Any]:
    runtime = _probe_model_runtime()
    mode = _reasoning_mode()
    return {
        "ok": True,
        "api": True,
        "backend_dir": str(BACKEND_DIR),
        "backend_name": BACKEND_DIR.name,
        "graph_dir": str(GRAPH_DIR),
        "corpus_path": str(_corpus_path()),
        "corpus_exists": _corpus_path().exists(),
        "session_subgraph_root": str(_session_subgraph_root()),
        "demo_collects_corpus": mode == "v4",
        "provider": "model",
        "reasoning_mode": mode,
        "runtime": runtime,
    }


@app.get("/api/graphs")
def graphs() -> Dict[str, Any]:
    summaries = []
    for path in _graph_paths().values():
        try:
            summaries.append(_graph_summary(path))
        except Exception as exc:
            summaries.append({
                "id": path.stem,
                "file": path.name,
                "error": str(exc),
            })
    return {"graphs": summaries}


@app.post("/api/runs")
async def run_graph_agent(req: RunRequest) -> Dict[str, Any]:
    if _reasoning_mode() != "v4" and not _probe_model_runtime(timeout=3.0)["ok"]:
        raise _json_error(
            503,
            "Model runtime is not available. Configure the runtime command before running chat.",
        )
    try:
        return _run_graph_agent(req)
    except HTTPException:
        raise
    except Exception as exc:
        raise _json_error(500, f"Run failed: {type(exc).__name__}: {exc}")


@app.post("/api/runs/stream")
async def stream_graph_agent(req: RunRequest) -> StreamingResponse:
    if _reasoning_mode() != "v4" and not _probe_model_runtime(timeout=3.0)["ok"]:
        raise _json_error(
            503,
            "Model runtime is not available. Configure the runtime command before running chat.",
        )

    if _reasoning_mode() == "v4":
        auto_config = os.environ.get("V4_AUTO_CONFIG", "1").strip() not in ("0", "false", "no")

        async def event_stream_v4():
            yield _sse("ready", {"ok": True, "provider": "model"})
            await asyncio.sleep(0)
            yield _sse("started", {
                "run_id": "pending",
                "graph_id": req.graph_id,
                "reasoning_mode": "v4",
            })
            await asyncio.sleep(0)
            yield _sse("action_start", {
                "action": "V4_REASONING_RUN",
                "reasoning_mode": "v4",
            })
            await asyncio.sleep(0)
            if auto_config:
                try:
                    level = _CLASSIFIER.classify(req.question)[0]
                    yield _sse("log", {"message": f"Classified as: {level}"})
                    await asyncio.sleep(0)
                except Exception:
                    pass

            try:
                final_payload = _run_graph_agent(req)
                session = final_payload.get("session", {})
                nodes = session.get("nodes", {}) if isinstance(session, dict) else {}
                edges = session.get("edges", []) if isinstance(session, dict) else []
                yield _sse("session_graph", {
                    "node_count": len(nodes),
                    "edge_count": len(edges),
                    "stage": "final",
                    "iteration": final_payload.get("steps_taken", 0),
                    "anchor_count": final_payload.get("metrics", {}).get("anchor_count", 0),
                })
                yield _sse("action_complete", {
                    "action": "V4_REASONING_RUN",
                    "content": final_payload.get("answer", ""),
                    "steps": final_payload.get("steps_taken", 0),
                    "tool_call_count": final_payload.get("packet", {}).get("tool_call_count", 0),
                })
                for invoc in final_payload.get("procedure_invocations", []) or []:
                    yield _sse("tool_result", {
                        "tool_name": "invoke_procedure",
                        "procedure_name": invoc.get("procedure"),
                        "success": invoc.get("error") is None,
                        "error": invoc.get("error"),
                        "summary": f"{invoc.get('procedure')} - {invoc.get('mutations_applied', 0)} mutations",
                    })
                yield _sse("final", final_payload)
            except Exception as exc:
                import traceback
                print(f"[stream-v4] ERROR: {type(exc).__name__}: {exc}", flush=True)
                traceback.print_exc()
                yield _sse("error", {"message": f"{type(exc).__name__}: {exc}"})

        return StreamingResponse(
            event_stream_v4(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    events: Queue[Optional[tuple[str, Dict[str, Any]]]] = Queue()

    def emit(event: str, data: Dict[str, Any]) -> None:
        events.put((event, data))

    def worker() -> None:
        try:
            final_payload = _run_graph_agent(req, emit=emit)
            emit("final", final_payload)
        except Exception as exc:
            import traceback
            print(f"[stream-worker] ERROR: {type(exc).__name__}: {exc}", flush=True)
            traceback.print_exc()
            emit("error", {"message": f"{type(exc).__name__}: {exc}"})
        finally:
            events.put(None)

    def event_stream():
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        yield _sse("ready", {"ok": True, "provider": "model"})
        while True:
            try:
                item = events.get(timeout=5)
            except Exception:
                # No event in 5s — send SSE keep-alive comment so the
                # proxy/browser doesn't drop the connection.
                yield ": keepalive\n\n"
                continue
            if item is None:
                break
            event, data = item
            yield _sse(event, data)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
