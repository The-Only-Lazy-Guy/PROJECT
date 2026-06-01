import { MarkerType, Position } from '@xyflow/react';
import type { SessionGraph, SessionNode, SessionEdge } from '../types';

export const NODE_LANE_ORDER = [
  'question',
  'evidence',
  'failure_pattern',
  'procedure',
  'session_object',
  'hypothesis',
  'plan_step',
  'answer',
  'conclusion',
  'signal',
  'diagnostics',
  'plan',
  'note',
];

export type FlowNode = {
  id: string;
  position: { x: number; y: number };
  data: { label: string; node: SessionNode };
  sourcePosition?: Position;
  targetPosition?: Position;
  style: Record<string, unknown>;
};

import type { Edge } from '@xyflow/react';

export type FlowEdge = Edge;

export function buildFlow(session: SessionGraph): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const laneRows = new Map<string, number>();
  const stepRows = new Map<number, number>();

  const flowNodes: FlowNode[] = Object.values(session.nodes).map((node) => {
    const step = Number.isFinite(node.created_step) ? node.created_step : 0;
    const lane = NODE_LANE_ORDER.includes(node.node_type) ? node.node_type : 'other';
    const laneIndex = NODE_LANE_ORDER.includes(lane) ? NODE_LANE_ORDER.indexOf(lane) : NODE_LANE_ORDER.length;
    const laneKey = `${step}:${lane}`;
    const row = laneRows.get(laneKey) ?? 0;
    laneRows.set(laneKey, row + 1);
    stepRows.set(step, (stepRows.get(step) ?? 0) + 1);

    return {
      id: node.id,
      position: { x: step * 420, y: laneIndex * 176 + row * 126 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: flowNodeLabel(node), node },
      style: {
        border: `2px solid ${nodeColor(node.node_type)}`,
        background: '#fffdf8',
        color: '#191817',
        borderRadius: 10,
        width: 330,
        minHeight: 104,
        padding: '12px 14px',
        boxShadow: '0 14px 35px rgba(39, 35, 30, 0.1)',
        whiteSpace: 'pre-wrap' as const,
        overflowWrap: 'anywhere' as const,
        textAlign: 'left' as const,
        fontSize: 14,
        lineHeight: 1.42,
      },
    };
  });

  const flowEdges: FlowEdge[] = session.edges.map((edge, index) => {
    const color = edgeColor(edge.relation);
    return {
      id: `${edge.src}-${edge.dst}-${edge.relation}-${index}`,
      source: edge.src,
      target: edge.dst,
      label: edge.relation,
      type: 'smoothstep',
      animated: edge.status !== 'verified',
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: edge.status === 'verified' ? 2.4 : 1.4 },
      labelStyle: { fill: color, fontWeight: 800, fontSize: 12 },
      labelBgStyle: { fill: '#fffdf8', fillOpacity: 0.92 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 6,
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function flowNodeLabel(node: SessionNode): string {
  const type = readableType(node.node_type);
  const title = shortText(node.text || node.id, 118);
  const id = shortText(node.id, 34);
  return `${type}\n${title}\n${id}`;
}

function readableType(type: string): string {
  return type.replace(/_/g, ' ').toUpperCase();
}

function shortText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function nodeColor(type: string): string {
  const colors: Record<string, string> = {
    question: '#171717',
    evidence: '#2d6f82',
    plan_step: '#c46a3d',
    note: '#4f7661',
    conclusion: '#1f4f77',
    hypothesis: '#9a6a2f',
    procedure: '#6b3fa0',
    failure_pattern: '#ba4f45',
    session_object: '#3f8a7c',
    answer: '#1f4f77',
    signal: '#c46a3d',
    diagnostics: '#6d665d',
    plan: '#c46a3d',
  };
  return colors[type] ?? '#6d665d';
}

function edgeColor(relation: string): string {
  const colors: Record<string, string> = {
    support: '#2f8a61',
    supports: '#2f8a61',
    contradict: '#ba4f45',
    related: '#9b9286',
    part_of: '#7b7167',
    refine: '#2f7f7a',
    derived_from: '#4e7394',
    calls: '#6b3fa0',
    applied_in: '#3f8a7c',
    failure_of: '#ba4f45',
    replacement_for: '#2f8a61',
    depends_on: '#c46a3d',
    retrieved: '#7b7167',
    matches: '#ba4f45',
    replaced_by: '#2f8a61',
    cited: '#9b9286',
    verified_by: '#2f8a61',
  };
  return colors[relation] ?? '#9b9286';
}

export type PathType = 'support' | 'contradiction' | 'dependency' | 'bridge';

export type EvidencePath = {
  id: string;
  type: PathType;
  nodes: string[];
  edges: SessionEdge[];
  interpretation: string;
  score: number;
};

export function extractEvidencePaths(graph: SessionGraph): EvidencePath[] {
  const paths: EvidencePath[] = [];
  const edges = graph.edges;
  const nodes = graph.nodes;

  const adj: Record<string, { dst: string; edge: SessionEdge }[]> = {};
  for (const edge of edges) {
    if (!adj[edge.src]) adj[edge.src] = [];
    adj[edge.src].push({ dst: edge.dst, edge });
  }

  const visited = new Set<string>();

  function dfs(current: string, pathEdges: SessionEdge[], pathNodes: string[], depth: number) {
    if (depth > 6 || pathNodes.length > 8) return;
    if (depth > 1) {
      const types = pathEdges.map((e) => e.relation);
      const pathType = classifyPath(types);
      if (pathType) {
        paths.push({
          id: `path-${paths.length}`,
          type: pathType,
          nodes: [...pathNodes],
          edges: [...pathEdges],
          interpretation: interpretPath(types),
          score: computeScore(pathEdges),
        });
      }
    }
    const neighbors = adj[current] ?? [];
    for (const { dst, edge } of neighbors) {
      if (visited.has(dst)) continue;
      visited.add(dst);
      pathEdges.push(edge);
      pathNodes.push(dst);
      dfs(dst, pathEdges, pathNodes, depth + 1);
      pathNodes.pop();
      pathEdges.pop();
      visited.delete(dst);
    }
  }

  for (const nid of Object.keys(nodes)) {
    visited.add(nid);
    dfs(nid, [], [nid], 0);
    visited.delete(nid);
  }

  return paths.sort((a, b) => b.score - a.score).slice(0, 20);
}

function classifyPath(types: string[]): PathType | null {
  if (types.length < 2) return null;
  const hasContradict = types.some((t) => t === 'contradict');
  const hasDepend = types.some((t) => t === 'depends_on');
  const allSupport = types.every((t) => ['support', 'supports', 'refine', 'part_of', 'example_of'].includes(t));
  if (hasContradict) return 'contradiction';
  if (hasDepend) return 'dependency';
  if (allSupport) return 'support';
  if (types.some((t) => t === 'related')) return 'bridge';
  return null;
}

function interpretPath(types: string[]): string {
  if (types.every((t) => ['support', 'supports', 'refine'].includes(t))) {
    return 'Indirect support chain: evidence flows through multiple supporting relations.';
  }
  if (types.some((t) => t === 'contradict')) {
    return 'Contradiction chain: upstream evidence challenges downstream claims.';
  }
  if (types.some((t) => t === 'depends_on')) {
    return 'Dependency chain: downstream depends on upstream being valid.';
  }
  if (types.some((t) => t === 'part_of')) {
    return 'Part-whole chain: nodes form a hierarchical composition.';
  }
  return 'Mixed relations: the path combines multiple evidence types.';
}

function computeScore(edges: SessionEdge[]): number {
  const base = edges.reduce((sum, e) => sum + e.confidence, 0) / edges.length;
  const bonus = edges.every((e) => e.status === 'verified') ? 0.15 : 0;
  return Math.min(1, base + bonus);
}
