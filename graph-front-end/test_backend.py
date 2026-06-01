import sys, os, json
sys.path.insert(0, 'E:/PROJECT/graph_v5')
os.environ['REASONING_MODE'] = 'v4'
from answerer_v4 import answer_query_v4, V4OpencodeController
from graph_core import MemoryGraph, Node, Edge

ctrl = V4OpencodeController(model='google/gemini-2.5-flash', timeout=60)
result = answer_query_v4(
    question='What is 2+2?',
    graph=MemoryGraph({}, []),
    controller=ctrl,
    max_steps=2,
    use_failure_boost=True,
    enable_plan_tree=False,
    enable_procedures=False,
    enable_activation=True,
)
print('=== ANSWER ===')
print(result['answer'])
print()
print('=== METRICS ===')
for k, v in result['metrics'].items():
    print(f'  {k}: {v}')
print()
print('=== KEY FIELDS ===')
for k in ['hypotheses', 'failures', 'meta_signals', 'plan_tree_summary', 'procedure_invocations', 'budget_summary']:
    if result.get(k):
        print(f'  {k}: present')
print()
print(f'tool_log entries: {len(result.get("tool_log", []))}')
print(f'cot_log entries: {len(result.get("cot_log", []))}')
