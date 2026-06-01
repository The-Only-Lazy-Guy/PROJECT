from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from api.frontend_api import RunRequest, _run_graph_agent, health


class TestFrontendApiModes(unittest.TestCase):
    def _req(self) -> RunRequest:
        return RunRequest(
            question="Can Dijkstra be trusted with one negative edge?",
            graph_id="cs4",
            k_anchors=8,
            anchor_strategy="topk",
        )

    def test_health_reports_reasoning_mode(self):
        with patch.dict(os.environ, {"REASONING_MODE": "substrate"}, clear=False):
            payload = health()
        self.assertEqual(payload["reasoning_mode"], "substrate")

    def test_legacy_mode_payload_shape(self):
        with patch.dict(os.environ, {"REASONING_MODE": "legacy"}, clear=False):
            with patch("api.frontend_api._call_model") as call_model:
                call_model.return_value = {
                    "answer": "<reasoning>legacy trace</reasoning><answer>legacy answer</answer>",
                    "stderr": "",
                    "returncode": 0,
                    "elapsed": 0.01,
                }
                payload = _run_graph_agent(self._req())

        self.assertEqual(payload["answer"], "legacy answer")
        self.assertEqual(payload["reasoning_trace"], "legacy trace")
        self.assertEqual(payload["packet"]["answer_type"], "graph_context")
        self.assertIn("session", payload)
        self.assertIn("trace", payload)
        self.assertNotIn("substrate", payload)

    def test_substrate_mode_payload_shape_and_artifacts(self):
        def scripted_model(prompt: str, *, timeout: float = 240):
            if "You are executing the VerifyAlgorithmPreconditions procedure." in prompt:
                return {
                    "answer": (
                        "ADD nonneg_edges TO state.preconditions_checked\n"
                        "ADD single_source_defined TO state.preconditions_checked\n"
                        "ADD nonneg_edges TO state.preconditions_violated\n"
                        'SET state.evidence_for_violations.nonneg_edges = "Edge b->c has weight -1"\n'
                        "DONE\n"
                        "Dijkstra requires nonnegative edge weights. Use Bellman-Ford here.\n"
                    ),
                    "stderr": "",
                    "returncode": 0,
                    "elapsed": 0.01,
                }
            if "Results from procedures invoked so far" in prompt:
                return {
                    "answer": (
                        "<reasoning>\n"
                        "GOAL: Deliver the verdict.\n"
                        "KNOWN: The nonnegative-edge precondition failed.\n"
                        "PLAN: State that Dijkstra is unsafe and recommend Bellman-Ford.\n"
                        "</reasoning>\n"
                        "<answer>\n"
                        "No. A negative edge breaks Dijkstra's assumptions, so Bellman-Ford is the safer choice.\n"
                        "</answer>"
                    ),
                    "stderr": "",
                    "returncode": 0,
                    "elapsed": 0.01,
                }
            return {
                "answer": (
                    "<reasoning>\n"
                    "GOAL: Check the algorithm preconditions.\n"
                    "KNOWN: The question mentions a negative edge.\n"
                    "PLAN: I'll apply VerifyAlgorithmPreconditions to Dijkstra on the described graph.\n"
                    "</reasoning>\n"
                ),
                "stderr": "",
                "returncode": 0,
                "elapsed": 0.01,
            }

        with tempfile.TemporaryDirectory() as td:
            with patch.dict(
                os.environ,
                {
                    "REASONING_MODE": "substrate",
                    "REASONING_SESSION_PERSIST_ROOT": td,
                },
                clear=False,
            ):
                with patch("api.frontend_api._call_model", side_effect=scripted_model):
                    payload = _run_graph_agent(self._req())

        self.assertIn("Bellman-Ford", payload["answer"])
        self.assertEqual(payload["packet"]["answer_type"], "reasoning_substrate")
        self.assertIn("substrate", payload)
        self.assertTrue(payload["substrate"]["session_subgraph_path"])
        self.assertTrue(
            payload["substrate"]["audit_summary"].get("micro_controller")
            or any(entry.get("action") == "INVOKE_PROCEDURE" for entry in payload["trace"])
        )
        self.assertTrue(
            any(
                node.get("node_type") in {"session_object", "diagnostics"}
                for node in payload["session"]["nodes"].values()
            )
        )
        if payload["substrate"]["audit_summary"].get("micro_controller"):
            self.assertGreaterEqual(len(payload["substrate"]["audit_summary"].get("micro_steps", [])), 1)
        else:
            self.assertGreaterEqual(payload["substrate"]["audit_summary"]["total_entries"], 1)

    def test_v4_mode_uses_graph_v5_corpus_paths(self):
        fake_packet = SimpleNamespace(
            answer="v4 answer",
            answer_raw="v4 answer",
            explanation="",
            polish_applied=False,
            steps=1,
            max_steps=20,
            finalized=True,
            elapsed_sec=0.01,
            tool_call_count=0,
            tool_log=[],
            cot_log=[],
            procedure_invocations=[],
            plan=[],
            failures=[],
            hypotheses={},
            anchors=[],
            citation_warnings=0,
            search_repeats=0,
            coverage_addressed_pct=1.0,
            coverage_rounds=0,
            task_frame_items=0,
            activation_signals=0,
            task_frame=None,
            task_frame_rendered="",
            coverage=None,
            plan_tree_summary=None,
            meta_signals=[],
            budget_summary=None,
            consolidation_decisions=[],
            session_dir="E:/PROJECT/graph_v5/data/session_subgraphs/test",
        )

        with patch.dict(os.environ, {"REASONING_MODE": "v4"}, clear=False):
            events = []
            with patch("api.frontend_api.answer_query_v4", return_value=fake_packet) as answer_call:
                payload = _run_graph_agent(
                    self._req(),
                    emit=lambda event, data: events.append((event, data)),
                )

        kwargs = answer_call.call_args.kwargs
        self.assertTrue(kwargs["collect_corpus"])
        self.assertTrue(callable(kwargs["event_callback"]))
        kwargs["event_callback"]("model_turn", {"step": 1})
        self.assertEqual(events[-1], ("model_turn", {"step": 1}))
        self.assertIn("graph_v5", str(kwargs["corpus_root"]))
        self.assertEqual(Path(kwargs["corpus_root"]).name, "distillation_corpus")
        self.assertIn("graph_v5", str(kwargs["session_root"]))
        self.assertEqual(payload["corpus"]["corpus_path"], str(Path(kwargs["corpus_root"]) / kwargs["corpus_file"]))
        self.assertEqual(payload["corpus"]["backend_dir"], str(Path("E:/PROJECT/graph_v5")))


if __name__ == "__main__":
    unittest.main()
