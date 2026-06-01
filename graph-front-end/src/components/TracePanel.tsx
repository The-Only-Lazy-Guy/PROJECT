import type { TraceEntry, SessionGraph } from '../types';
import { asJson, short } from '../utils/formatting';

export function TracePanel(props: { trace: TraceEntry[]; session: SessionGraph }) {
  if (props.trace.length === 0) {
    return <p className="microcopy">No public trace entries were returned.</p>;
  }

  const v4toolActions = ['read_node', 'expand_neighbors', 'search_nodes', 'hypothesize', 'verify_hypotheses', 'record_failure', 'create_object', 'update_object', 'read_object', 'list_objects', 'mark_done', 'plan_add_child', 'plan_record_check', 'plan_mark_passed', 'plan_mark_failed', 'plan_revise', 'invoke_procedure', 'list_anchors'];
  const dispatchEntries = props.trace.filter((e) => e.action === 'INVOKE_PROCEDURE' || e.action === 'invoke_procedure');
  const toolCallEntries = props.trace.filter((e) => e.action !== 'INVOKE_PROCEDURE' && e.action !== 'invoke_procedure' && v4toolActions.includes(e.action ?? ''));
  const otherEntries = props.trace.filter((e) => !v4toolActions.includes(e.action ?? '') && e.action !== 'INVOKE_PROCEDURE' && e.action !== 'invoke_procedure');

  return (
    <div className="trace-list">
      <p className="trace-note">
        Public trace only: prompt construction, model run metadata, and returned payloads.
      </p>

      {dispatchEntries.length > 0 && (
        <details className="trace-dispatch-group" open>
          <summary>
            <strong>Procedure dispatch</strong>
            <span className="microcopy"> ({dispatchEntries.length} calls)</span>
          </summary>
          {dispatchEntries.map((entry, index) => (
            <article className="trace-card dispatch" key={`dispatch-${index}`}>
              <div className="trace-top">
                <span className={successOf(entry) ? 'ok-chip' : 'fail-chip'}>
                  {successOf(entry) ? 'success' : 'failed'}
                </span>
                <strong>{String(entry.args?.procedure_name ?? entry.action)}</strong>
                <em>step {entry.step ?? index}</em>
              </div>
              {entry.thought && <p>{entry.thought}</p>}
              {entry.result?.summary ? <p className="microcopy">{String(entry.result.summary)}</p> : null}
              {entry.result?.mutations_applied !== undefined && (
                <p className="microcopy">Mutations: {String(entry.result.mutations_applied)}</p>
              )}
              <details>
                <summary>Arguments</summary>
                <pre>{asJson(entry.args)}</pre>
              </details>
              <details>
                <summary>Result</summary>
                <pre>{asJson(entry.result ?? entry.error)}</pre>
              </details>
            </article>
          ))}
        </details>
      )}

      {toolCallEntries.length > 0 && (
        <details className="trace-dispatch-group" open>
          <summary>
            <strong>Tool calls</strong>
            <span className="microcopy"> ({toolCallEntries.length} calls)</span>
          </summary>
          {toolCallEntries.map((entry, index) => (
            <article className="trace-card dispatch" key={`tool-${index}`}>
              <div className="trace-top">
                <span className={successOf(entry) ? 'ok-chip' : 'fail-chip'}>
                  {successOf(entry) ? 'success' : 'failed'}
                </span>
                <strong>{String(entry.action)}</strong>
                <em>step {entry.step ?? index}</em>
              </div>
              {entry.thought && <p>{entry.thought}</p>}
              {entry.result?.summary ? <p className="microcopy">{String(entry.result.summary)}</p> : null}
              <details>
                <summary>Args</summary>
                <pre>{asJson(entry.args)}</pre>
              </details>
              <details>
                <summary>Result</summary>
                <pre>{asJson(entry.result ?? entry.error)}</pre>
              </details>
            </article>
          ))}
        </details>
      )}

      {otherEntries.map((entry, index) => (
        <article className="trace-card" key={`${entry.step ?? index}-${entry.action ?? ''}`}>
          <div className="trace-top">
            <span className={successOf(entry) ? 'ok-chip' : 'fail-chip'}>
              {successOf(entry) ? 'success' : 'failed'}
            </span>
            <strong>{String(entry.action ?? 'UNKNOWN')}</strong>
            <em>step {entry.step ?? index} &middot; {entry.phase ?? '?'}</em>
          </div>
          {entry.thought && <p>{entry.thought}</p>}
          {entry.result?.summary ? <p className="microcopy">{String(entry.result.summary)}</p> : null}
          {entry.result?.raw_output !== undefined && (
            <details>
              <summary>Raw Model Output</summary>
              <pre>{String(entry.result.raw_output)}</pre>
            </details>
          )}
          <SupportUsageBlock entry={entry} session={props.session} />
          <details>
            <summary>Arguments</summary>
            <pre>{asJson(entry.args)}</pre>
          </details>
          <details>
            <summary>Result</summary>
            <pre>{asJson(entry.result ?? entry.error)}</pre>
          </details>
        </article>
      ))}
    </div>
  );
}

function successOf(entry: TraceEntry): boolean {
  return Boolean(entry.result?.success);
}

function SupportUsageBlock(props: { entry: TraceEntry; session: SessionGraph }) {
  const args = props.entry.args ?? {};
  const supportUsage = args.support_usage;
  const supports = Array.isArray(args.supports) ? args.supports.map(String) : [];
  if (!supportUsage || typeof supportUsage !== 'object' || Array.isArray(supportUsage)) {
    return null;
  }
  const usage = supportUsage as Record<string, unknown>;
  const ids = supports.length > 0 ? supports : Object.keys(usage);
  if (ids.length === 0) return null;

  return (
    <div className="support-usage">
      <strong>Support usage</strong>
      {ids.map((id) => {
        const node = props.session.nodes[id];
        return (
          <div className="support-row" key={id}>
            <span>{id}</span>
            <p>{String(usage[id] ?? '-')}</p>
            <small>{node ? short(node.text, 180) : 'Support node not found in session.'}</small>
          </div>
        );
      })}
    </div>
  );
}
