export function PhaseTimeline() {
  return (
    <div className="phase-timeline">
      <PhaseCard
        phase="Phase 1"
        status="complete"
        title="Reasoning substrate"
        copy="Session subgraphs, audit logs, procedure dispatch, budgets, failure-pattern retrieval, consolidation."
      />
      <PhaseCard
        phase="Phase 2A"
        status="complete"
        title="Composition"
        copy="Structured sub-procedure calls, call-tree edges, version metadata, seed procedure family, and inspectable non-dispatch sessions."
      />
      <PhaseCard
        phase="Phase 2B"
        status="planned"
        title="Evidence compilation"
        copy="Deterministic evidence-packet compiler, relation-chain interpretation, scored path extraction, and structured answer planning."
      />
      <PhaseCard
        phase="Phase 3A"
        status="planned"
        title="Meta signals"
        copy="Deterministic meta-procedures detect cycles, contradictions, dispatch misses, and budget pressure — inject concise signals into the next prompt."
      />
    </div>
  );
}

function PhaseCard(props: { phase: string; status: string; title: string; copy: string }) {
  return (
    <article className={`phase-card ${props.status}`}>
      <div className="phase-card-top">
        <span>{props.phase}</span>
        <code>{props.status}</code>
      </div>
      <h3>{props.title}</h3>
      <p>{props.copy}</p>
    </article>
  );
}
