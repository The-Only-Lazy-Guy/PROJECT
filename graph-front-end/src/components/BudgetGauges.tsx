import type { BudgetUsage } from '../types';
import { pct, budgetColor } from '../utils/formatting';

export function BudgetGauges(props: { usage?: BudgetUsage | null }) {
  const { usage } = props;
  if (!usage) {
    return (
      <div className="budget-panel">
        <p className="microcopy">No budget data available for this run.</p>
      </div>
    );
  }

  return (
    <div className="budget-panel">
      <h3>Budget usage</h3>
      <div className="budget-grid">
        <Gauge label="LLM calls" used={usage.llm_calls_used} max={usage.llm_calls_max} />
        <Gauge label="Tokens" used={usage.tokens_used} max={usage.tokens_max} />
        <Gauge label="Graph hops" used={usage.graph_hops_used} max={usage.graph_hops_max} />
        <Gauge label="Subgraph nodes" used={usage.subgraph_nodes} max={usage.subgraph_nodes_max} />
        <Gauge label="Recursion depth" used={usage.recursion_depth} max={usage.recursion_depth_max} />
      </div>
    </div>
  );
}

function Gauge(props: { label: string; used: number; max: number }) {
  const percent = pct(props.used, props.max);
  const color = budgetColor(props.used, props.max);

  return (
    <div className="budget-gauge">
      <div className="budget-gauge-header">
        <span className="budget-gauge-label">{props.label}</span>
        <span className="budget-gauge-value">{props.used} / {props.max}</span>
      </div>
      <div className="budget-gauge-track">
        <div
          className="budget-gauge-fill"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
    </div>
  );
}
