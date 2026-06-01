export type RuntimeInfo = {
  ok: boolean;
  status_code: number | null;
  latency_ms: number;
  version?: string;
  error?: string | null;
};

export type HealthResponse = {
  ok: boolean;
  api: boolean;
  backend_dir: string;
  graph_dir: string;
  provider: string;
  reasoning_mode?: 'legacy' | 'substrate';
  runtime?: RuntimeInfo;
  opencode?: RuntimeInfo & { command?: string; attach_url?: string };
};

export type GraphSummary = {
  id: string;
  file: string;
  nodes?: number;
  edges?: number;
  node_types?: Record<string, number>;
  edge_relations?: Record<string, number>;
  error?: string;
};

export type RunRequest = {
  question: string;
  graph_id: string;
  k_anchors: number;
  anchor_strategy: 'topk' | 'mmr' | 'legacy';
  use_failure_boost?: boolean;
  enable_plan_tree?: boolean;
  enable_procedures?: boolean;
  enable_activation?: boolean;
  max_steps?: number;
};

export type SessionNode = {
  id: string;
  text: string;
  node_type: string;
  source_memory_id?: string | null;
  confidence: number;
  relevance: number;
  metadata?: Record<string, unknown>;
  created_step: number;
};

export type SessionEdge = {
  src: string;
  dst: string;
  relation: string;
  status: string;
  confidence: number;
  created_step: number;
  metadata?: Record<string, unknown>;
};

export type SessionGraph = {
  question: string;
  step: number;
  nodes: Record<string, SessionNode>;
  edges: SessionEdge[];
  paths: Record<string, unknown>;
  frontier: unknown[];
};

export type TraceEntry = {
  step?: number;
  phase?: string;
  action?: string;
  args?: Record<string, unknown>;
  thought?: string;
  result?: {
    success?: boolean;
    summary?: string;
    error?: string | null;
    new_paths?: number;
    new_nodes?: number;
    new_edges?: number;
    [key: string]: unknown;
  };
  error?: string;
};

export type BudgetUsage = {
  llm_calls_used: number;
  llm_calls_max: number;
  tokens_used: number;
  tokens_max: number;
  graph_hops_used: number;
  graph_hops_max: number;
  subgraph_nodes: number;
  subgraph_nodes_max: number;
  recursion_depth: number;
  recursion_depth_max: number;
};

export type HypothesisInfo = {
  text: string;
  verdict: 'verified' | 'discarded' | null;
  evidence: string | null;
};

export type PlanSubgoal = {
  text: string;
  done: boolean;
};

export type PlanTreeSummary = {
  root_goal?: string;
  nodes?: Record<string, {
    goal: string;
    status: string;
    mode?: string;
    hypothesis?: string;
  }>;
  state?: {
    active_node_id?: string;
    revision_count?: number;
    max_revisions?: number;
    backtrack_count?: number;
    max_backtracks?: number;
    finalized?: boolean;
    last_failure_reason?: string;
  };
};

export type MetaSignal = {
  id: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  sticky?: boolean;
  source?: string;
};

export type ProcedureInvocation = {
  procedure: string;
  procedure_id?: string;
  object_id?: string;
  mutations_applied?: number;
  state?: Record<string, unknown>;
  error?: string | null;
  elapsed_sec?: number;
};

export type FailureRecordInfo = {
  approach: string;
  condition: string;
  mechanism: string;
  recorded_at_step: number;
};

export type ConsolidationDecision = {
  node_id: string;
  node_type: string;
  decision: 'promote' | 'deprecate' | 'keep';
  reason: string;
  gate_results?: Record<string, boolean | number>;
};

export type AuditEntry = {
  step_index: number;
  object_id: string;
  operation: 'create' | 'read' | 'update' | 'delete';
  field_path?: string;
  old_value?: unknown;
  new_value?: unknown;
  triggered_by_text?: string;
};

export type AuditSummary = {
  total_entries?: number;
  entries?: AuditEntry[];
  by_operation?: Record<string, number>;
  by_object?: Record<string, number>;
  [key: string]: unknown;
};

export type FrameItem = {
  item_id: string;
  kind: string;
  text: string;
  priority: number;
  source_signal_ids: string[];
};

export type TaskFrame = {
  session_id: string;
  constraints: FrameItem[];
  pitfalls: FrameItem[];
  suggested_structures: FrameItem[];
  relevant_examples: FrameItem[];
  procedure_suggestions: FrameItem[];
  unresolved_gaps: FrameItem[];
};

export type CoverageItem = {
  item_id: string;
  kind: string;
  text: string;
  addressed: boolean;
};

export type CoverageResult = {
  addressed_item_ids: string[];
  missed_item_ids: string[];
  coverage: number;
  items: CoverageItem[];
};

export type SubstrateData = {
  audit_summary?: AuditEntry[] | AuditSummary;
  budget_usage?: BudgetUsage;
  consolidation_decisions?: ConsolidationDecision[];
  session_subgraph_path?: string;
  session_subgraph?: Record<string, unknown>;
};

export type RunResponse = {
  run_id: string;
  question: string;
  graph_id: string;
  graph_file: string;
  answer: string;
  confidence: number;
  steps_taken: number;
  elapsed: number;
  packet: Record<string, unknown>;
  trace: TraceEntry[];
  session: SessionGraph;
  metrics: {
    steps: number;
    confidence: number;
    nodes: number;
    edges: number;
    paths: number;
    failures: number;
    elapsed_seconds: number;
    usage_coverage?: number | null;
    usage_pairs?: number;
    usage_weak?: number;
    plan_coverage?: number | null;
    anchor_quality?: number | null;
    anchor_count?: number;
    prompt_chars?: number;
    answer_chars?: number;
    citation_warnings?: number;
    search_repeats?: number;
    coverage_addressed_pct?: number;
    coverage_rounds?: number;
    task_frame_items?: number;
    activation_signals?: number;
  };
  substrate?: SubstrateData;
  hypotheses?: Record<string, HypothesisInfo>;
  plan?: PlanSubgoal[];
  failures?: FailureRecordInfo[];
  plan_tree_summary?: PlanTreeSummary;
  meta_signals?: MetaSignal[];
  budget_summary?: Record<string, unknown>;
  procedure_invocations?: ProcedureInvocation[];
  session_dir?: string;
  max_steps?: number;
  finalized?: boolean;
  task_frame?: TaskFrame | null;
  task_frame_rendered?: string;
  coverage?: CoverageResult | null;
  // Phase 12-17 additions
  answer_raw?: string;
  explanation?: string;
  polish_applied?: boolean;
  classified_level?: 'trivial' | 'moderate' | 'complex' | null;
  reasoning_trace?: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  runId?: string;
};

export type StreamEventName =
  | 'ready'
  | 'started'
  | 'action_start'
  | 'model_turn'
  | 'plan_update'
  | 'session_graph'
  | 'token'
  | 'stream_warning'
  | 'action_complete'
  | 'answer_candidate'
  | 'tool_result'
  | 'log'
  | 'final'
  | 'error';

export type RunStreamEvent = {
  event: StreamEventName;
  data: Record<string, unknown>;
};
