export function ArchitectureDiagram() {
  return (
    <div className="arch-flow-diagram">
      <div className="arch-flow-row">
        <ArchBox label="Question" icon="?" color="#1f4f77" />
        <ArchArrow />
        <ArchBox label="Anchor Retrieval" icon="\u2191" color="#2d6f82" sub="Similarity search over memory nodes" />
        <ArchArrow />
        <ArchBox label="Session Graph" icon="\u25C6" color="#3f8a7c" sub="Working memory with mutable objects" />
        <ArchArrow />
        <ArchBox label="Procedure Dispatch" icon="\u2699" color="#6b3fa0" sub="Free-text pattern match \u2192 structured action" />
        <ArchArrow />
        <ArchBox label="Evidence Compilation" icon="\u2261" color="#c46a3d" sub="Paths, chains, contradictions" />
        <ArchArrow />
        <ArchBox label="Answer" icon="\u2713" color="#2f8a61" />
      </div>
      <p className="arch-flow-caption">
        Each query drives a multi-step loop. The graph is not just context — it is the medium of computation.
        <span className="tooltip-trigger" data-tip="Unlike RAG where retrieved chunks are dumped into context, the session graph is incrementally built and mutated step by step."> Learn more</span>
      </p>
    </div>
  );
}

function ArchBox(props: { label: string; icon: string; color: string; sub?: string }) {
  return (
    <div className="arch-box" style={{ '--box-color': props.color } as React.CSSProperties}>
      <span className="arch-box-icon">{props.icon}</span>
      <span className="arch-box-label">{props.label}</span>
      {props.sub && <span className="arch-box-sub">{props.sub}</span>}
    </div>
  );
}

function ArchArrow() {
  return <span className="arch-arrow">&rarr;</span>;
}
