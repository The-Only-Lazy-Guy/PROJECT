import { useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import type { RunResponse, SessionEdge, SessionGraph, SessionNode } from '../types';
import { buildFlow, extractEvidencePaths, type EvidencePath } from '../utils/graphLayout';

const NODE_TYPE_COLORS: Record<string, string> = {
  question: '#171717',
  evidence: '#2d6f82',
  plan_step: '#c46a3d',
  plan: '#c46a3d',
  note: '#4f7661',
  conclusion: '#1f4f77',
  hypothesis: '#9a6a2f',
  procedure: '#6b3fa0',
  failure_pattern: '#ba4f45',
  session_object: '#3f8a7c',
  answer: '#1f4f77',
  signal: '#c46a3d',
  diagnostics: '#6d665d',
};

const NODE_TYPE_DESCRIPTIONS: Record<string, string> = {
  question: 'The user request that seeded this temporary reasoning workspace.',
  evidence: 'Retrieved or generated support material used while forming the answer.',
  procedure: 'A reusable reasoning routine that can be dispatched by the model.',
  session_object: 'Mutable procedure state. These nodes show what the loop tracked and changed.',
  answer: 'The final answer node written back from the completed session.',
  conclusion: 'A structured claim produced from evidence and procedure state.',
  failure_pattern: 'A known bad reasoning pattern retrieved to prevent a repeat mistake.',
  signal: 'A runtime warning or diagnostic signal emitted by the substrate.',
  diagnostics: 'Session-level metrics and post-run debugging information.',
  hypothesis: 'A provisional claim considered during the reasoning loop. Has a verdict (verified/discarded) once evaluated.',
  plan_step: 'A planned intermediate step used to organize the answer. Marked done via mark_done tool.',
  plan: 'A planning-related node in the adaptive plan tree.',
  note: 'Supporting scratch state or commentary attached to the session graph.',
};

const RELATION_DESCRIPTIONS: Record<string, string> = {
  support: 'supports a downstream claim',
  supports: 'supports a downstream claim',
  contradict: 'challenges or blocks a claim',
  calls: 'dispatches a procedure',
  applied_in: 'records where a procedure was applied',
  depends_on: 'requires another node to hold',
  derived_from: 'was produced from upstream evidence',
  part_of: 'belongs to a larger structure',
  related: 'is associated context',
  failure_of: 'marks a failed approach',
  replacement_for: 'suggests a safer alternative',
  retrieved: 'was retrieved from memory for this session',
  matches: 'matches a known pattern',
  replaced_by: 'was replaced by a different approach',
  cited: 'was cited as support in reasoning',
  verified_by: 'was confirmed by a verification step',
  refine: 'refines or updates a previous step',
};

export function SessionGraphView(props: { run: RunResponse }) {
  const [selected, setSelected] = useState<SessionNode | null>(null);
  const [selectedPath, setSelectedPath] = useState<EvidencePath | null>(null);

  const session = props.run.session;
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => buildFlow(session),
    [session],
  );

  const evidencePaths = useMemo(
    () => extractEvidencePaths(session),
    [session],
  );

  const nodeTypeCounts = useMemo(() => countNodeTypes(session), [session]);
  const relationCounts = useMemo(() => countRelations(session), [session]);
  const supportPaths = evidencePaths.filter((path) => path.type === 'support');
  const contradictPaths = evidencePaths.filter((path) => path.type === 'contradiction');
  const dependencyPaths = evidencePaths.filter((path) => path.type === 'dependency');
  const bridgePaths = evidencePaths.filter((path) => path.type === 'bridge');
  const selectedEdges = selected ? connectedEdges(session, selected.id) : [];

  function handleNodeClick(_: unknown, node: { data: { node: SessionNode } }) {
    setSelected(node.data.node);
    setSelectedPath(null);
  }

  function handlePathClick(path: EvidencePath) {
    setSelectedPath(path.id === selectedPath?.id ? null : path);
    setSelected(null);
  }

  return (
    <div className="graph-pane">
      <div className="graph-main">
        <section className="graph-explainer">
          <div>
            <div className="eyebrow">Session graph</div>
            <h3>What the model built while answering this run</h3>
            <p>
              The graph reads left to right by reasoning step. Rows separate the question,
              evidence, procedures, mutable session objects, final answer, and diagnostics.
              Edges show why a node exists: support, procedure calls, dependencies, or warnings.
            </p>
          </div>
          <div className="graph-summary-grid">
            <GraphMetric label="Nodes" value={Object.keys(session.nodes).length} />
            <GraphMetric label="Edges" value={session.edges.length} />
            <GraphMetric label="Steps" value={props.run.steps_taken} />
            <GraphMetric label="Confidence" value={`${(props.run.confidence * 100).toFixed(0)}%`} />
            {props.run.metrics.citation_warnings !== undefined && (
              <GraphMetric label="Uncited" value={props.run.metrics.citation_warnings} />
            )}
            {props.run.metrics.search_repeats !== undefined && (
              <GraphMetric label="Repeats" value={props.run.metrics.search_repeats} />
            )}
            {props.run.metrics.coverage_addressed_pct !== undefined && (
              <GraphMetric label="Coverage" value={`${(props.run.metrics.coverage_addressed_pct * 100).toFixed(0)}%`} />
            )}
          </div>
        </section>

        <section className="graph-legend-panel">
          <div className="legend-group">
            <strong>Node roles in this run</strong>
            <div className="legend-chip-list">
              {Object.entries(nodeTypeCounts).map(([type, count]) => (
                <LegendChip key={type} label={readableType(type)} count={count} color={nodeTypeColor(type)} />
              ))}
            </div>
          </div>
          <div className="legend-group">
            <strong>Edge meanings</strong>
            <div className="legend-chip-list">
              {Object.entries(relationCounts).map(([relation, count]) => (
                <RelationChip key={relation} relation={relation} count={count} />
              ))}
            </div>
          </div>
        </section>

        <div className="flow-wrap">
          {flowNodes.length > 0 ? (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              minZoom={0.2}
              maxZoom={1.35}
              onNodeClick={handleNodeClick}
            >
              <Background color="#d8d0c4" gap={28} />
              <MiniMap
                pannable
                zoomable
                nodeStrokeWidth={3}
                nodeColor={(node) => nodeTypeColor(String((node.data?.node as SessionNode | undefined)?.node_type ?? ''))}
              />
              <Controls />
            </ReactFlow>
          ) : (
            <div className="empty-graph-state">
              <strong>No session nodes were returned for this run.</strong>
              <p>The answer can still be valid, but the substrate did not dispatch a procedure or persist inspectable state.</p>
            </div>
          )}
        </div>

        {evidencePaths.length > 0 && (
          <div className="evidence-path-strip">
            <PathGroup title="Support paths" tone="support" paths={supportPaths} selectedPath={selectedPath} onSelect={handlePathClick} />
            <PathGroup title="Contradictions" tone="contradict" paths={contradictPaths} selectedPath={selectedPath} onSelect={handlePathClick} />
            <PathGroup title="Dependencies" tone="dependency" paths={dependencyPaths} selectedPath={selectedPath} onSelect={handlePathClick} />
            <PathGroup title="Bridges" tone="bridge" paths={bridgePaths} selectedPath={selectedPath} onSelect={handlePathClick} />
          </div>
        )}

        {selectedPath && (
          <div className="path-interpretation">
            <strong>Path: {selectedPath.nodes.join(' -> ')}</strong>
            <p>{selectedPath.interpretation}</p>
            <div className="path-score">
              Score: <b>{selectedPath.score.toFixed(2)}</b> &middot;
              Type: <b>{selectedPath.type}</b> &middot;
              Edges: <b>{selectedPath.edges.length}</b>
            </div>
          </div>
        )}
      </div>

      <aside className="node-detail">
        {selected ? (
          <NodeDetail node={selected} session={session} selectedEdges={selectedEdges} />
        ) : selectedPath ? (
          <>
            <h3>Evidence Path</h3>
            <p>{selectedPath.interpretation}</p>
            <dl>
              <dt>Type</dt>
              <dd>{selectedPath.type}</dd>
              <dt>Score</dt>
              <dd>{(selectedPath.score * 100).toFixed(0)}%</dd>
              <dt>Nodes</dt>
              <dd>{selectedPath.nodes.join(' -> ')}</dd>
              <dt>Edges</dt>
              <dd>{selectedPath.edges.map((edge) => `${edge.src} ${edge.relation} ${edge.dst}`).join('; ')}</dd>
            </dl>
          </>
        ) : (
          <GraphDetailEmpty nodeTypeCounts={nodeTypeCounts} relationCounts={relationCounts} />
        )}
      </aside>
    </div>
  );
}

function NodeDetail(props: { node: SessionNode; session: RunResponse['session']; selectedEdges: SessionEdge[] }) {
  const { node, selectedEdges } = props;
  const nodeType = node.node_type;
  const metadata = (node.metadata ?? {}) as Record<string, unknown>;

  return (
    <>
      <span className="node-type" style={{ background: `${nodeTypeColor(nodeType)}22`, color: nodeTypeColor(nodeType) }}>
        {readableType(nodeType)}
      </span>
      <h3>{node.id}</h3>
      <p className="node-role-copy">{NODE_TYPE_DESCRIPTIONS[nodeType] ?? 'A session node produced during this run.'}</p>
      {node.text ? <p className="node-text">{node.text}</p> : null}

      <dl>
        <dt>Created step</dt>
        <dd>{node.created_step}</dd>
        <dt>Confidence</dt>
        <dd>{node.confidence.toFixed(2)}</dd>
        <dt>Source</dt>
        <dd>{node.source_memory_id ?? '-'}</dd>
        <dt>Relevance</dt>
        <dd>{node.relevance.toFixed(2)}</dd>
      </dl>

      {nodeType === 'hypothesis' && Boolean(metadata.verdict) && (
        <div className="hypothesis-verdict-row">
          <span className={`verdict-badge ${String(metadata.verdict)}`}>
            {String(metadata.verdict)}
          </span>
          {Boolean(metadata.evidence) && (
            <p className="microcopy">Evidence: {String(metadata.evidence)}</p>
          )}
        </div>
      )}

      {nodeType === 'session_object' && Boolean(metadata.state) && (
        <details>
          <summary>Procedure state</summary>
          <pre className="detail-json">{JSON.stringify(metadata.state, null, 2)}</pre>
        </details>
      )}

      {nodeType === 'procedure' && metadata.purpose ? (
        <details>
          <summary>Procedure details</summary>
          <p className="small-muted">{String(metadata.purpose)}</p>
          {metadata.when_to_use ? (
            <p className="small-muted">Use when: {String(metadata.when_to_use)}</p>
          ) : null}
          {metadata.signature ? (
            <pre className="detail-json">{JSON.stringify(metadata.signature, null, 2)}</pre>
          ) : null}
        </details>
      ) : null}

      {nodeType === 'session_object' && Array.isArray(metadata.fields) && (
        <details>
          <summary>Object schema</summary>
          <p className="microcopy">Fields: {(metadata.fields as string[]).join(', ')}</p>
        </details>
      )}

      {nodeType === 'plan_step' && metadata.done !== undefined && (
        <p className="microcopy">Done: {metadata.done ? 'yes' : 'no'}</p>
      )}

      {nodeType === 'failure_pattern' ? (
        <details>
          <summary>Failure details</summary>
          {metadata.attempted_approach ? (
            <p className="small-muted">Approach: {String(metadata.attempted_approach)}</p>
          ) : null}
          {metadata.failure_condition ? (
            <p className="small-muted">Fails when: {String(metadata.failure_condition)}</p>
          ) : null}
          {metadata.failure_mechanism ? (
            <p className="small-muted">Why: {String(metadata.failure_mechanism)}</p>
          ) : null}
        </details>
      ) : null}

      <details>
        <summary>Raw metadata</summary>
        <pre className="detail-json">{JSON.stringify(metadata, null, 2)}</pre>
      </details>

      <div className="node-connections">
        <strong>Connected edges</strong>
        {selectedEdges.length === 0 ? (
          <p className="microcopy">This node has no recorded incoming or outgoing edges.</p>
        ) : selectedEdges.slice(0, 12).map((edge, index) => (
          <div key={index} className="connection-row">
            <span className={`relation-chip ${edge.relation}`}>{readableType(edge.relation)}</span>
            <span>{edge.src === node.id ? `to ${edge.dst}` : `from ${edge.src}`}</span>
            <span className="microcopy">{edge.status} / {(edge.confidence * 100).toFixed(0)}%</span>
          </div>
        ))}
        {selectedEdges.length > 12 ? (
          <p className="microcopy">Showing 12 of {selectedEdges.length} connected edges.</p>
        ) : null}
      </div>
    </>
  );
}

function GraphMetric(props: { label: string; value: string | number }) {
  return (
    <div className="graph-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function LegendChip(props: { label: string; count: number; color: string }) {
  return (
    <span className="legend-chip" style={{ borderColor: props.color, color: props.color }}>
      <i style={{ background: props.color }} />
      {props.label}
      <b>{props.count}</b>
    </span>
  );
}

function RelationChip(props: { relation: string; count: number }) {
  const description = RELATION_DESCRIPTIONS[props.relation] ?? 'links two session nodes';
  return (
    <span className={`legend-chip relation-chip ${props.relation}`} title={description}>
      {readableType(props.relation)}
      <b>{props.count}</b>
    </span>
  );
}

function PathGroup(props: {
  title: string;
  tone: string;
  paths: EvidencePath[];
  selectedPath: EvidencePath | null;
  onSelect: (path: EvidencePath) => void;
}) {
  if (props.paths.length === 0) return null;
  return (
    <div className="path-group">
      <span className={`path-group-label ${props.tone}`}>{props.title}</span>
      <div className="path-group-list">
        {props.paths.slice(0, 6).map((path) => (
          <button
            key={path.id}
            className={`path-chip ${props.tone} ${props.selectedPath?.id === path.id ? 'active' : ''}`}
            onClick={() => props.onSelect(path)}
          >
            <span>{path.nodes.slice(0, 4).join(' -> ')}</span>
            <b>{(path.score * 100).toFixed(0)}%</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function GraphDetailEmpty(props: { nodeTypeCounts: Record<string, number>; relationCounts: Record<string, number> }) {
  return (
    <>
      <h3>Graph inspector</h3>
      <p>
        This panel expands whichever graph object is selected. Node details show
        role, confidence, source memory, procedure state, raw metadata, and the
        incoming or outgoing edges that connect it to the answer.
      </p>
      <dl>
        <dt>Node families</dt>
        <dd>{Object.entries(props.nodeTypeCounts).map(([type, count]) => `${readableType(type)} ${count}`).join(', ') || '-'}</dd>
        <dt>Relations</dt>
        <dd>{Object.entries(props.relationCounts).map(([relation, count]) => `${readableType(relation)} ${count}`).join(', ') || '-'}</dd>
      </dl>
    </>
  );
}

function countNodeTypes(session: SessionGraph): Record<string, number> {
  return Object.values(session.nodes).reduce<Record<string, number>>((acc, node) => {
    acc[node.node_type] = (acc[node.node_type] ?? 0) + 1;
    return acc;
  }, {});
}

function countRelations(session: SessionGraph): Record<string, number> {
  return session.edges.reduce<Record<string, number>>((acc, edge) => {
    acc[edge.relation] = (acc[edge.relation] ?? 0) + 1;
    return acc;
  }, {});
}

function connectedEdges(session: SessionGraph, nodeId: string): SessionEdge[] {
  return session.edges.filter((edge) => edge.src === nodeId || edge.dst === nodeId);
}

function nodeTypeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? '#6d665d';
}

function readableType(type: string): string {
  return type.replace(/_/g, ' ');
}
