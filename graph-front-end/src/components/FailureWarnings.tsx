import type { SessionGraph, FailureRecordInfo } from '../types';

export function FailureWarnings(props: {
  session: SessionGraph;
  failures?: FailureRecordInfo[] | null;
}) {
  const { session, failures } = props;
  const hasFailureRecords = failures && failures.length > 0;

  const failureNodeIds = Object.values(session.nodes)
    .filter((n) => n.node_type === 'failure_pattern')
    .map((n) => n.id);

  const failureEdges = session.edges.filter(
    (e) => failureNodeIds.includes(e.src) && e.relation === 'failure_of',
  );

  if (failureNodeIds.length === 0 && !hasFailureRecords) {
    return (
      <div className="failure-warnings-panel">
        <p className="microcopy">No failure patterns were retrieved or created in this session.</p>
      </div>
    );
  }

  return (
    <div className="failure-warnings-panel">
      <h3>Failure patterns{hasFailureRecords ? ` (${failures!.length})` : ''}</h3>
      <div className="failure-warnings-list">
        {hasFailureRecords && failures!.map((f, i) => (
          <div key={`fr-${i}`} className="failure-warning-card">
            <div className="failure-warning-header">
              <span className="failure-icon">&#9888;</span>
              <strong>{f.approach}</strong>
              <span className="microcopy">step {f.recorded_at_step}</span>
            </div>
            {f.condition && (
              <p className="failure-condition">
                <span>Fails when:</span> {f.condition}
              </p>
            )}
            {f.mechanism && (
              <p className="failure-mechanism">
                <span>Why:</span> {f.mechanism}
              </p>
            )}
          </div>
        ))}
        {failureNodeIds.map((nid) => {
          const node = session.nodes[nid];
          const targetEdges = failureEdges.filter((e) => e.src === nid);
          const replacementEdges = session.edges.filter(
            (e) => e.dst === nid && e.relation === 'replacement_for',
          );

          return (
            <div key={nid} className="failure-warning-card">
              <div className="failure-warning-header">
                <span className="failure-icon">&#9888;</span>
                <strong>{node.text || nid}</strong>
              </div>
              {node.metadata?.failure_condition ? (
                <p className="failure-condition">
                  <span>Fails when:</span> {String(node.metadata.failure_condition)}
                </p>
              ) : null}
              {node.metadata?.failure_mechanism ? (
                <p className="failure-mechanism">
                  <span>Why:</span> {String(node.metadata.failure_mechanism)}
                </p>
              ) : null}
              {targetEdges.length > 0 && (
                <div className="failure-targets">
                  <span className="microcopy">Affects procedures:</span>
                  {targetEdges.map((e, i) => (
                    <code key={i}>{e.dst}</code>
                  ))}
                </div>
              )}
              {replacementEdges.length > 0 && (
                <div className="failure-replacements">
                  <span className="microcopy">Recommended alternative:</span>
                  {replacementEdges.map((e, i) => (
                    <code key={i} className="replacement-link">{e.src}</code>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
