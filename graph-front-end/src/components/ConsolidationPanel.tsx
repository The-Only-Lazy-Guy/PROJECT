import type { ConsolidationDecision } from '../types';

export function ConsolidationPanel(props: { decisions?: ConsolidationDecision[] | null }) {
  const decisions = props.decisions ?? [];

  if (decisions.length === 0) {
    return (
      <div className="consolidation-panel">
        <p className="microcopy">No consolidation decisions for this run.</p>
      </div>
    );
  }

  return (
    <div className="consolidation-panel">
      <h3>Consolidation decisions</h3>
      <div className="consolidation-list">
        {decisions.map((d, i) => (
          <div key={i} className={`consolidation-card decision-${d.decision}`}>
            <div className="consolidation-top">
              <span className={`consolidation-badge ${d.decision}`}>{d.decision}</span>
              <strong>{d.node_id}</strong>
              <code className="consolidation-type">{d.node_type}</code>
            </div>
            <p className="microcopy">{d.reason}</p>
            {d.gate_results && Object.keys(d.gate_results).length > 0 && (
              <details>
                <summary>Gate results</summary>
                <div className="gate-list">
                  {Object.entries(d.gate_results).map(([key, val]) => (
                    <div key={key} className="gate-row">
                      <span>{key}</span>
                      <span className={val ? 'gate-pass' : 'gate-fail'}>
                        {typeof val === 'boolean' ? (val ? 'pass' : 'fail') : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
