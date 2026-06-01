import { useMemo } from 'react';
import { Background, ReactFlow } from '@xyflow/react';
import type { RunStreamEvent, SessionEdge, SessionGraph, SessionNode } from '../types';
import { buildFlow } from '../utils/graphLayout';
import { short } from '../utils/formatting';

export function LiveSessionGraph(props: { events: RunStreamEvent[]; question: string }) {
  const session = useMemo(
    () => sessionFromEvents(props.events, props.question),
    [props.events, props.question],
  );
  const { nodes, edges } = useMemo(() => buildFlow(session), [session]);
  const latest = props.events[props.events.length - 1];
  const latestSnapshot = [...props.events].reverse().find((event) => event.event === 'session_graph');

  return (
    <div className="live-session-card">
      <div className="live-session-head">
        <div>
          <strong>Live session graph</strong>
          <span>{snapshotStage(latestSnapshot) || eventLabel(latest)}</span>
        </div>
        <div className="live-session-counts">
          <span>{Object.keys(session.nodes).length} nodes</span>
          <span>{session.edges.length} edges</span>
        </div>
      </div>
      <div className="live-session-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.28 }}
          minZoom={0.18}
          maxZoom={1.1}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
        >
          <Background color="#d8d0c4" gap={26} />
        </ReactFlow>
      </div>
    </div>
  );
}

function sessionFromEvents(events: RunStreamEvent[], question: string): SessionGraph {
  const snapshot = [...events].reverse().find((event) => event.event === 'session_graph');
  const rawSession = snapshot?.data.session_subgraph;
  const normalized = normalizeRawSession(rawSession);
  if (normalized && Object.keys(normalized.nodes).length > 0) {
    return normalized;
  }
  return syntheticSession(events, question);
}

function normalizeRawSession(value: unknown): SessionGraph | null {
  if (!isRecord(value)) return null;
  const rawNodes = isRecord(value.nodes) ? value.nodes : {};
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const nodes: Record<string, SessionNode> = {};
  for (const [id, rawNode] of Object.entries(rawNodes)) {
    nodes[id] = normalizeNode(id, rawNode);
  }
  const edges = rawEdges
    .map((edge) => normalizeEdge(edge))
    .filter((edge): edge is SessionEdge => Boolean(edge && nodes[edge.src] && nodes[edge.dst]));

  return {
    question: stringValue(value.query) || stringValue(value.question),
    step: numberValue(value.step_count) ?? numberValue(value.step) ?? 0,
    nodes,
    edges,
    paths: {},
    frontier: [],
  };
}

function syntheticSession(events: RunStreamEvent[], question: string): SessionGraph {
  const nodes: Record<string, SessionNode> = {
    Q0: syntheticNode('Q0', 'question', question || 'Question submitted', 0),
  };
  const edges: SessionEdge[] = [];
  let previous = 'Q0';
  let index = 1;

  for (const event of events.filter((row) => row.event !== 'ready')) {
    const id = `live_${index}`;
    const node = nodeForEvent(id, event, index);
    nodes[id] = node;
    edges.push(syntheticEdge(previous, id, event.event === 'tool_result' ? 'calls' : 'derived_from', node.created_step));
    previous = id;
    index += 1;
  }

  return {
    question,
    step: Math.max(0, index - 1),
    nodes,
    edges,
    paths: {},
    frontier: [],
  };
}

function nodeForEvent(id: string, event: RunStreamEvent, index: number): SessionNode {
  if (event.event === 'started') {
    return syntheticNode(id, 'plan_step', `Run started on ${stringValue(event.data.graph_id) || 'selected graph'}`, index);
  }
  if (event.event === 'action_start') {
    return syntheticNode(id, 'procedure', `${stringValue(event.data.action) || 'Action'} started`, index);
  }
  if (event.event === 'action_complete') {
    return syntheticNode(id, 'answer', short(stringValue(event.data.content) || 'Action completed', 180), index);
  }
  if (event.event === 'model_turn') {
    const step = numberValue(event.data.step) ?? index;
    const tools = numberValue(event.data.tool_call_count) ?? 0;
    return syntheticNode(id, 'reasoning_atom', `Model turn ${step}: ${tools} tool calls`, index);
  }
  if (event.event === 'plan_update') {
    const plan = Array.isArray(event.data.plan) ? event.data.plan.length : 0;
    return syntheticNode(id, 'plan_step', `Plan updated with ${plan} subgoals`, index);
  }
  if (event.event === 'answer_candidate') {
    return syntheticNode(id, 'answer', `Answer candidate (${numberValue(event.data.answer_chars) ?? 0} chars)`, index);
  }
  if (event.event === 'tool_result') {
    const toolName = stringValue(event.data.tool_name) || stringValue(event.data.procedure_name) || '';
    const summary = stringValue(event.data.summary) || `${toolName || 'Tool'} result`;
    if (toolName.includes('hypothesize') || toolName.includes('verify')) {
      return syntheticNode(id, 'hypothesis', summary, index);
    }
    if (toolName.includes('failure') || toolName.includes('record_failure')) {
      return syntheticNode(id, 'failure_pattern', summary, index);
    }
    if (toolName.includes('object') || toolName.includes('create_object') || toolName.includes('update_object')) {
      return syntheticNode(id, 'session_object', summary, index);
    }
    if (toolName.includes('plan')) {
      return syntheticNode(id, 'plan_step', summary, index);
    }
    if (toolName.includes('invoke_procedure')) {
      return syntheticNode(id, 'procedure', summary, index);
    }
    return syntheticNode(id, 'session_object', summary, index);
  }
  if (event.event === 'stream_warning') {
    return syntheticNode(id, 'signal', stringValue(event.data.message) || 'Stream warning', index);
  }
  if (event.event === 'error') {
    return syntheticNode(id, 'signal', stringValue(event.data.message) || 'Error', index);
  }
  return syntheticNode(id, 'note', eventLabel(event), index);
}

function normalizeNode(id: string, value: unknown): SessionNode {
  const raw = isRecord(value) ? value : {};
  const nodeType = stringValue(raw.node_type) || 'note';
  const state = isRecord(raw.state) ? compactState(raw.state) : '';
  const text =
    stringValue(raw.text)
    || stringValue(raw.name)
    || state
    || id;
  const metadata = isRecord(raw.metadata) ? raw.metadata : raw;
  return {
    id: stringValue(raw.id) || id,
    text,
    node_type: nodeType,
    source_memory_id: stringValue(raw.source_memory_id) || null,
    confidence: numberValue(raw.confidence) ?? 0.82,
    relevance: numberValue(raw.relevance) ?? 0.8,
    metadata,
    created_step: numberValue(raw.created_step) ?? 0,
  };
}

function normalizeEdge(value: unknown): SessionEdge | null {
  if (!isRecord(value)) return null;
  const src = stringValue(value.src);
  const dst = stringValue(value.dst);
  if (!src || !dst) return null;
  return {
    src,
    dst,
    relation: stringValue(value.relation) || 'related',
    status: stringValue(value.status) || 'observed',
    confidence: numberValue(value.confidence) ?? 0.8,
    created_step: numberValue(value.created_step) ?? 0,
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function syntheticNode(id: string, nodeType: string, text: string, step: number): SessionNode {
  return {
    id,
    text,
    node_type: nodeType,
    confidence: 0.8,
    relevance: 0.8,
    metadata: {},
    created_step: step,
  };
}

function syntheticEdge(src: string, dst: string, relation: string, step: number): SessionEdge {
  return {
    src,
    dst,
    relation,
    status: 'live',
    confidence: 0.8,
    created_step: step,
    metadata: {},
  };
}

function snapshotStage(event: RunStreamEvent | undefined): string {
  if (!event) return '';
  return stringValue(event.data.stage)?.replace(/_/g, ' ') || '';
}

function eventLabel(event: RunStreamEvent | undefined): string {
  if (!event) return 'Waiting for stream events';
  return event.event.replace(/_/g, ' ');
}

function compactState(state: Record<string, unknown>): string {
  const parts = Object.entries(state).slice(0, 4).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: ${value.slice(0, 3).join(', ')}`;
    return `${key}: ${String(value)}`;
  });
  return parts.join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
