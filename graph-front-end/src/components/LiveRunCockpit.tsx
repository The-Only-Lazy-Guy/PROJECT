import { useEffect, useRef, useState } from 'react';
import type {
  AuditEntry,
  ChatMessage,
  CoverageResult,
  FrameItem,
  GraphSummary,
  RunRequest,
  RunResponse,
  RunStreamEvent,
} from '../types';
import { AuditLogViewer } from './AuditLogViewer';
import { MarkdownContent } from './MarkdownContent';
import { TracePanel } from './TracePanel';

const DEFAULT_QUESTION = 'Why can light travel through space but sound cannot?';
const EXAMPLES = [
  DEFAULT_QUESTION,
  'Can Dijkstra be trusted with one negative edge?',
  'Are heat and temperature the same quantity?',
];

const TASK_FRAME_SECTIONS = [
  { key: 'constraints', title: 'Constraints' },
  { key: 'pitfalls', title: 'Pitfalls' },
  { key: 'suggested_structures', title: 'Suggested structures' },
  { key: 'relevant_examples', title: 'Relevant examples' },
  { key: 'procedure_suggestions', title: 'Procedure suggestions' },
  { key: 'unresolved_gaps', title: 'Unresolved gaps' },
] as const;

type Settings = { k_anchors: number; anchor_strategy: RunRequest['anchor_strategy'] };

type Props = {
  messages: ChatMessage[];
  question: string;
  setQuestion: (q: string) => void;
  onSubmit: () => void;
  onExample: (text: string) => void;
  loading: boolean;
  lastRun: RunResponse | null;
  liveTokens: string;
  liveEvents: RunStreamEvent[];
  liveQuestion: string;
  selectedGraph?: GraphSummary;
  clearChat: () => void;
  onBackToOverview?: () => void;
  graphs?: GraphSummary[];
  onGraphChange?: (id: string) => void;
  settings?: Settings;
  onSettingsChange?: (s: Settings) => void;
};

export function LiveRunCockpit(props: Props) {
  const hasConversation = props.messages.length > 0 || props.loading;
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [props.messages.length, props.liveEvents.length, props.liveTokens]);

  return (
    <div className="gc-shell">
      <header className="gc-header">
        <div className="gc-header-left">
          {props.onBackToOverview && (
            <button type="button" className="gc-nav-btn" onClick={props.onBackToOverview}>
              &larr; Overview
            </button>
          )}
          <div className="gc-graph-selector">
            {props.graphs && props.graphs.length > 1 && props.onGraphChange ? (
              <select
                value={props.selectedGraph?.id ?? ''}
                onChange={(e) => props.onGraphChange!(e.target.value)}
                disabled={props.loading}
              >
                {props.graphs.map((g) => (
                  <option key={g.id} value={g.id}>{g.file}</option>
                ))}
              </select>
            ) : (
              <span className="gc-graph-name">{props.selectedGraph?.file ?? 'No graph selected'}</span>
            )}
          </div>
        </div>
        <div className="gc-header-center">
          <span className={`gc-status ${props.loading ? 'live' : props.lastRun ? 'done' : ''}`}>
            <i />
            <span>{stageLabel(props.liveEvents, props.loading, props.lastRun)}</span>
          </span>
          {props.lastRun?.run_id && (
            <code className="gc-run-id">{props.lastRun.run_id}</code>
          )}
        </div>
        <div className="gc-header-right">
          <button type="button" className="gc-clear-btn" onClick={props.clearChat}>
            Clear
          </button>
        </div>
      </header>

      <div className="gc-body">
        <div className="gc-chat">
          <div className="gc-messages">
            {!hasConversation && (
              <div className="gc-welcome" style={{ animation: 'scaleIn 0.5s var(--ease-spring)' }}>
                <div style={{ width: 56, height: 56, borderRadius: 20, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', marginBottom: 12, border: '1px solid var(--border)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"/>
                    <circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                </div>
                <h2>Graph-grounded reasoning</h2>
                <p>Submit a question to watch the agent traverse your knowledge graph and build a live reasoning structure.</p>
                <div className="gc-examples" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {EXAMPLES.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => props.onExample(text)}
                      style={{ padding: '0.8rem 1rem', display: 'flex', gap: 10, alignItems: 'center' }}
                    >
                      <span style={{ color: 'var(--muted)' }}>→</span>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {props.messages.map((msg, index) => (
              <MessageBubble
                key={`${msg.role}-${index}-${msg.runId ?? ''}`}
                message={msg}
                run={props.lastRun}
              />
            ))}

            {props.loading && (
              <StreamingOutput
                events={props.liveEvents}
                liveTokens={props.liveTokens}
                question={props.liveQuestion}
              />
            )}

            <div ref={msgEndRef} />
          </div>

          <form
            className="gc-composer"
            onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}
          >
            <textarea
              value={props.question}
              onChange={(e) => props.setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!props.loading && props.question.trim()) props.onSubmit();
                }
              }}
              placeholder="Ask the graph-agent..."
              rows={1}
              disabled={props.loading}
            />
            <button type="submit" disabled={props.loading || !props.question.trim()}>
              {props.loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'pulse-glow 1s infinite' }} />
                  Running
                </div>
              ) : 'Run'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function MessageBubble(props: { message: ChatMessage; run: RunResponse | null }) {
  const isAssistant = props.message.role === 'assistant';
  const attached = isAssistant && props.run && props.message.runId === props.run.run_id;

  return (
    <div className={`gc-bubble-row ${props.message.role}`}>
      <div className={`gc-bubble ${props.message.role}`}>
        {isAssistant && attached && props.run ? (
          <AnswerPanel run={props.run} />
        ) : (
          <p>{props.message.content}</p>
        )}
      </div>
    </div>
  );
}

function AnswerPanel(props: { run: RunResponse }) {
  const r = props.run;
  const thoughtText = buildThoughtMarkdown(r);
  const inspectorVisible = shouldShowInspector(r);

  return (
    <div className="gc-answer-panel">
      <div className="gc-answer-header">
        <span className="gc-role-label">assistant</span>
        <div className="gc-answer-meta">
          {r.classified_level && (
            <span className={`gc-level-badge gc-level-${r.classified_level}`}>
              {r.classified_level}
            </span>
          )}
          {r.polish_applied && <span className="gc-polish-badge">polished</span>}
          <span>{(r.confidence * 100).toFixed(0)}% confidence</span>
          <span>{r.metrics.anchor_count ?? 0} anchors</span>
          <span>{coverageLabel(r.coverage, r.metrics.coverage_addressed_pct)} coverage</span>
        </div>
      </div>

      {thoughtText && (
        <ThoughtDisclosure
          title={`Thought for ${formatDuration(r.elapsed)}`}
          subtitle={truncateText(r.question, 96)}
          content={thoughtText}
          contentMode="markdown"
        />
      )}

      <section className="gc-answer-main">
        <MarkdownContent text={r.answer || '(no answer)'} />
      </section>

      {inspectorVisible && (
        <details className="gc-inspect-panel">
          <summary>Inspect task frame, checker, and memory</summary>
          <div className="gc-inspect-body">
            {(taskFrameItemCount(r) > 0 || Boolean(r.task_frame_rendered)) && (
              <TaskFramePage run={r} />
            )}
            {hasCheckerDetails(r) && (
              <AnswerCheckerPage run={r} showAnswer={false} />
            )}
            {hasMemoryDetails(r) && (
              <MemoryTracePage run={r} />
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function TaskFramePage(props: { run: RunResponse }) {
  const frame = props.run.task_frame;
  const sections = frame
    ? TASK_FRAME_SECTIONS.filter(({ key }) => frame[key].length > 0)
    : [];
  const frameItems = taskFrameItemCount(props.run);

  return (
    <div className="gc-page-stack">
      <div className="gc-summary-strip">
        <SummaryCard label="Frame items" value={frameItems} />
        <SummaryCard label="Coverage" value={coverageLabel(props.run.coverage, props.run.metrics.coverage_addressed_pct)} />
        <SummaryCard label="Checker rounds" value={props.run.metrics.coverage_rounds ?? 0} />
      </div>

      <p className="gc-page-copy">
        The graph task frame captures what the agent pulled forward from anchors and nearby memory before it wrote the final answer.
      </p>

      {sections.length > 0 ? (
        <div className="gc-frame-grid">
          {sections.map((section) => (
            <TaskFrameSection
              key={section.key}
              title={section.title}
              items={frame![section.key]}
            />
          ))}
        </div>
      ) : (
        <EmptyCard
          title="No task frame returned"
          copy="This run may have answered directly, or activation may not have produced a structured frame for the query."
        />
      )}

      {props.run.task_frame_rendered && (
        <details className="gc-debug-log">
          <summary>Raw graph task frame</summary>
          <pre className="gc-frame-raw">{props.run.task_frame_rendered}</pre>
        </details>
      )}
    </div>
  );
}

function AnswerCheckerPage(props: { run: RunResponse; showAnswer?: boolean }) {
  const coverage = props.run.coverage;
  const coverageItems = coverage?.items ?? [];
  const missedCount = coverage?.missed_item_ids.length ?? 0;
  const addressedCount = coverage?.addressed_item_ids.length ?? 0;
  const checkerStatus = checkerStatusLabel(props.run);

  return (
    <div className="gc-page-stack">
      <div className="gc-summary-strip">
        <SummaryCard label="Checker status" value={checkerStatus} tone={missedCount > 0 ? 'warn' : 'ok'} />
        <SummaryCard label="Coverage" value={coverageLabel(coverage, props.run.metrics.coverage_addressed_pct)} />
        <SummaryCard label="Addressed" value={addressedCount} tone="ok" />
        <SummaryCard label="Missed" value={missedCount} tone={missedCount > 0 ? 'warn' : 'muted'} />
      </div>

      {(props.showAnswer ?? true) && (
        <section className="gc-answer-content">
          <MarkdownContent text={props.run.answer || '(no answer)'} />
        </section>
      )}

      {(props.showAnswer ?? true) && props.run.explanation && (
        <details className="gc-explanation" open>
          <summary>Model explanation</summary>
          <MarkdownContent text={props.run.explanation} />
        </details>
      )}

      <div className="gc-checker-grid">
        <section className="gc-checker-card">
          <div className="gc-checker-top">
            <strong>Coverage checker</strong>
            <span className={`gc-check-badge ${missedCount > 0 ? 'warn' : 'ok'}`}>{checkerStatus}</span>
          </div>
          {coverageItems.length > 0 ? (
            <div className="gc-checker-list">
              {coverageItems.map((item) => (
                <article key={item.item_id} className={`gc-check-item ${item.addressed ? 'hit' : 'miss'}`}>
                  <span className="gc-check-state">{item.addressed ? 'addressed' : 'missed'}</span>
                  <div>
                    <strong>{humanize(item.kind)}</strong>
                    <p>{item.text}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="microcopy">No itemized checker report was returned for this run.</p>
          )}
        </section>

        <section className="gc-checker-card">
          <div className="gc-checker-top">
            <strong>Run signals</strong>
            <span className="gc-check-badge neutral">{props.run.meta_signals?.length ?? 0} signals</span>
          </div>
          {props.run.meta_signals && props.run.meta_signals.length > 0 ? (
            <div className="gc-signal-list">
              {props.run.meta_signals.map((signal) => (
                <article key={signal.id} className={`gc-signal-card ${signal.severity}`}>
                  <div className="gc-signal-top">
                    <span>{signal.severity}</span>
                    {signal.source && <code>{signal.source}</code>}
                  </div>
                  <p>{signal.message}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="microcopy">No runtime warnings or checker signals were attached to this answer.</p>
          )}
        </section>
      </div>

      {(props.showAnswer ?? true) && props.run.answer_raw && props.run.answer_raw !== props.run.answer && (
        <details className="gc-explanation">
          <summary>Answer draft before polish</summary>
          <MarkdownContent text={props.run.answer_raw} />
        </details>
      )}
    </div>
  );
}

function MemoryTracePage(props: { run: RunResponse }) {
  const auditEntries = extractAuditEntries(props.run);
  const totalAuditEntries = auditEntryCount(props.run, auditEntries);

  return (
    <div className="gc-page-stack">
      <div className="gc-summary-strip">
        <SummaryCard label="Trace events" value={props.run.trace.length} />
        <SummaryCard label="Audit entries" value={totalAuditEntries} />
        <SummaryCard label="Session nodes" value={Object.keys(props.run.session.nodes).length} />
      </div>

      <section className="gc-trace-section">
        <div className="gc-section-head">
          <h4>Memory trace</h4>
          <span>{props.run.trace.length} events</span>
        </div>
        <TracePanel trace={props.run.trace} session={props.run.session} />
      </section>

      <section className="gc-trace-section">
        <div className="gc-section-head">
          <h4>Audit trail</h4>
          <span>{totalAuditEntries} journal entries</span>
        </div>
        {auditEntries.length > 0 ? (
          <AuditLogViewer entries={auditEntries} />
        ) : totalAuditEntries > 0 ? (
          <EmptyCard
            title="Audit summary returned without entry details"
            copy="The backend reported audit activity for this run, but the detailed journal rows were not included in the response payload."
          />
        ) : (
          <EmptyCard
            title="No audit trail returned"
            copy="This run did not expose a mutation journal in the current response mode."
          />
        )}
      </section>

      <details className="gc-debug-log">
        <summary>Raw trace events ({props.run.trace.length})</summary>
        <RawTraceLog trace={props.run.trace} />
      </details>
    </div>
  );
}

function TaskFrameSection(props: { title: string; items: FrameItem[] }) {
  return (
    <section className="gc-frame-section">
      <div className="gc-section-head">
        <h4>{props.title}</h4>
        <span>{props.items.length}</span>
      </div>
      <div className="gc-frame-list">
        {props.items.map((item) => (
          <article key={item.item_id} className="gc-frame-item">
            <div className="gc-frame-item-top">
              <strong>{humanize(item.kind)}</strong>
              <span>priority {item.priority}</span>
            </div>
            <p>{item.text}</p>
            {item.source_signal_ids.length > 0 && (
              <small>Signals: {item.source_signal_ids.join(', ')}</small>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function SummaryCard(props: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className={`gc-summary-card ${props.tone ?? 'muted'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function EmptyCard(props: { title: string; copy: string }) {
  return (
    <div className="gc-empty-card">
      <strong>{props.title}</strong>
      <p>{props.copy}</p>
    </div>
  );
}

function RawTraceLog(props: { trace: RunResponse['trace'] }) {
  return (
    <div className="gc-raw-output">
      {props.trace.map((entry, index) => (
        <div key={`${entry.step ?? index}-${entry.action ?? 'trace'}`} className="gc-raw-line">
          <span className="gc-raw-step">{entry.step ?? index}</span>
          <span className="gc-raw-phase">{entry.phase ?? entry.action ?? ''}</span>
          <span className="gc-raw-msg">{entry.result?.summary ?? entry.thought ?? entry.error ?? ''}</span>
        </div>
      ))}
      {props.trace.length === 0 && (
        <p className="gc-empty">No trace data</p>
      )}
    </div>
  );
}

function ThoughtDisclosure(props: {
  title: string;
  subtitle?: string;
  badge?: string;
  content: string;
  contentMode: 'markdown' | 'plain';
  events?: RunStreamEvent[];
  emptyCopy?: string;
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const relevantEvents = (props.events ?? []).filter((event) => event.event !== 'token').slice(-6);

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, props.content, relevantEvents.length]);

  return (
    <section className={`gc-thought-panel ${props.live ? 'live' : ''}`}>
      <button
        type="button"
        className="gc-thought-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="gc-thought-summary">
          <span className="gc-thought-title">{props.title}</span>
          {props.subtitle && <span className="gc-thought-subtitle">{props.subtitle}</span>}
        </div>
        <div className="gc-thought-actions">
          {props.badge && (
            <span className={`gc-thought-badge ${props.live ? 'live' : ''}`}>
              {props.badge}
            </span>
          )}
          <span className="gc-thought-chevron">{open ? 'Hide' : 'Show'}</span>
        </div>
      </button>

      {open && (
        <div className="gc-thought-body" ref={scrollRef}>
          {props.content ? (
            props.contentMode === 'markdown' ? (
              <div className="gc-thought-stream">
                <MarkdownContent text={props.content} />
              </div>
            ) : (
              <pre className="gc-thought-stream gc-thought-stream-plain">{props.content}</pre>
            )
          ) : (
            <p className="gc-empty">{props.emptyCopy ?? 'No reasoning text returned.'}</p>
          )}

          {relevantEvents.length > 0 && (
            <div className="gc-thought-events">
              {relevantEvents.map((event, index) => (
                <div key={`${event.event}-${index}`} className="gc-thought-event">
                  <span className={`gc-thought-event-tag gc-thought-event-tag-${event.event}`}>
                    {humanize(event.event)}
                  </span>
                  <span>{formatEvent(event)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StreamingOutput(props: { events: RunStreamEvent[]; liveTokens: string; question: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(1);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="gc-bubble-row assistant">
      <div className="gc-bubble assistant live">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="gc-role-label" style={{ margin: 0 }}>assistant</span>
          <span className="gc-status live" style={{ padding: '2px 8px', fontSize: '0.65rem' }}>
            <i /> {streamStatusLabel(props.events, props.liveTokens)}
          </span>
        </div>

        <LiveStepTimeline events={props.events} elapsedSeconds={elapsedSeconds} />

        {props.liveTokens ? (
          <ThoughtDisclosure
            title={`Thinking for ${formatDuration(elapsedSeconds)}`}
            subtitle={truncateText(props.question || 'Working through the graph', 96)}
            badge="Live stream"
            content={props.liveTokens}
            contentMode="plain"
            events={props.events}
            live
          />
        ) : (
          <div className="gc-shimmer-skeleton" style={{ padding: '1rem', background: 'var(--panel-hover)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 12, background: 'var(--border-2)', borderRadius: 4, width: '85%', animation: 'shimmer 2s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--border-2) 0px, var(--border) 40px, var(--border-2) 80px)', backgroundSize: '200% 100%' }} />
            <div style={{ height: 12, background: 'var(--border-2)', borderRadius: 4, width: '60%', animation: 'shimmer 2s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--border-2) 0px, var(--border) 40px, var(--border-2) 80px)', backgroundSize: '200% 100%', animationDelay: '0.2s' }} />
            <div style={{ height: 12, background: 'var(--border-2)', borderRadius: 4, width: '40%', animation: 'shimmer 2s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--border-2) 0px, var(--border) 40px, var(--border-2) 80px)', backgroundSize: '200% 100%', animationDelay: '0.4s' }} />
            <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
              {props.events.length > 0 ? `Latest: ${props.events[props.events.length - 1].event}` : 'Initializing graph reasoning...'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveStepTimeline(props: { events: RunStreamEvent[]; elapsedSeconds: number }) {
  const steps = props.events
    .filter((event) => !['ready', 'token'].includes(event.event))
    .slice(-18);
  const latest = steps[steps.length - 1];

  return (
    <section className="gc-live-steps">
      <div className="gc-live-steps-head">
        <div>
          <strong>Live steps</strong>
          <span>{latest ? formatEvent(latest) : 'Waiting for the first graph event...'}</span>
        </div>
        <code>{formatDuration(props.elapsedSeconds)}</code>
      </div>

      <div className="gc-live-step-list">
        {steps.length > 0 ? steps.map((event, index) => (
          <article
            key={`${event.event}-${String(event.data.step ?? index)}-${index}`}
            className={`gc-live-step ${event.event}`}
          >
            <span className={`gc-live-step-tag gc-live-step-tag-${event.event}`}>
              {shortEventName(event.event)}
            </span>
            <div>
              <strong>{liveStepTitle(event)}</strong>
              <p>{formatEvent(event)}</p>
            </div>
          </article>
        )) : (
          <article className="gc-live-step waiting">
            <span className="gc-live-step-tag">wait</span>
            <div>
              <strong>Connecting to stream</strong>
              <p>The backend will report model turns and graph tool calls here.</p>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function formatEvent(e: RunStreamEvent): string {
  if (e.event === 'ready') return 'stream connected';
  if (e.event === 'started') return `run started on ${String(e.data.graph_id ?? 'selected graph')}`;
  if (e.event === 'action_start') return `action: ${String(e.data.action ?? '')}`;
  if (e.event === 'model_turn') {
    const toolCount = Number(e.data.tool_call_count ?? 0);
    const suffix = e.data.has_answer ? ' and drafted an answer' : '';
    return `model turn ${Number(e.data.step ?? 0)} emitted ${toolCount} tool call${toolCount === 1 ? '' : 's'}${suffix}`;
  }
  if (e.event === 'plan_update') {
    const plan = Array.isArray(e.data.plan) ? e.data.plan : [];
    return `${String(e.data.kind ?? 'plan')} with ${plan.length} subgoal${plan.length === 1 ? '' : 's'}`;
  }
  if (e.event === 'action_complete') return `completed: ${String(e.data.action ?? '')}`;
  if (e.event === 'answer_candidate') {
    return `answer candidate at step ${Number(e.data.step ?? 0)} (${Number(e.data.answer_chars ?? 0)} chars)`;
  }
  if (e.event === 'tool_result') {
    const tool = String(e.data.tool_name ?? e.data.procedure_name ?? e.data.action ?? 'tool');
    const detail = e.data.summary ? ` - ${String(e.data.summary).slice(0, 120)}` : '';
    return `${tool} ${e.data.success === false ? 'failed' : 'ok'}${detail}`;
  }
  if (e.event === 'session_graph') {
    return `graph: ${Number(e.data.node_count ?? 0)} nodes, ${Number(e.data.edge_count ?? 0)} edges`;
  }
  if (e.event === 'stream_warning') return String(e.data.message ?? 'warning');
  if (e.event === 'log') return String(e.data.message ?? 'log');
  if (e.event === 'error') return String(e.data.message ?? 'error');
  if (e.event === 'final') return 'run complete';
  return e.event.replace(/_/g, ' ');
}

function liveStepTitle(event: RunStreamEvent): string {
  if (event.event === 'started') return 'Run started';
  if (event.event === 'action_start') return String(event.data.action ?? 'Action started');
  if (event.event === 'model_turn') return `Model turn ${Number(event.data.step ?? 0)}`;
  if (event.event === 'plan_update') return 'Plan updated';
  if (event.event === 'tool_result') return String(event.data.tool_name ?? event.data.procedure_name ?? 'Tool result');
  if (event.event === 'answer_candidate') return 'Answer candidate';
  if (event.event === 'session_graph') return 'Session graph snapshot';
  if (event.event === 'action_complete') return 'Run action complete';
  if (event.event === 'final') return 'Final payload received';
  if (event.event === 'log') return 'Runtime note';
  if (event.event === 'stream_warning') return 'Stream warning';
  if (event.event === 'error') return 'Run error';
  return humanize(event.event);
}

function shortEventName(event: RunStreamEvent['event']): string {
  if (event === 'action_start') return 'start';
  if (event === 'action_complete') return 'done';
  if (event === 'model_turn') return 'turn';
  if (event === 'plan_update') return 'plan';
  if (event === 'tool_result') return 'tool';
  if (event === 'answer_candidate') return 'draft';
  if (event === 'session_graph') return 'graph';
  return event.replace(/_/g, ' ').slice(0, 8);
}

function stageLabel(events: RunStreamEvent[], loading: boolean, run: RunResponse | null): string {
  if (run) return 'final';
  if (loading && events.length === 0) return 'connecting';
  const latest = events[events.length - 1];
  if (!latest) return 'idle';
  return latest.event.replace(/_/g, ' ');
}

function taskFrameItemCount(run: RunResponse): number {
  if (!run.task_frame) return run.metrics.task_frame_items ?? 0;
  return TASK_FRAME_SECTIONS.reduce((sum, section) => sum + run.task_frame![section.key].length, 0);
}

function coverageLabel(coverage: CoverageResult | null | undefined, fallback?: number | null): string {
  if (coverage && Number.isFinite(coverage.coverage)) {
    return `${Math.round(coverage.coverage * 100)}%`;
  }
  if (fallback !== undefined && fallback !== null && Number.isFinite(fallback)) {
    return `${Math.round(fallback * 100)}%`;
  }
  return '--';
}

function checkerStatusLabel(run: RunResponse): string {
  const coverage = run.coverage;
  if (!coverage && taskFrameItemCount(run) === 0) return 'not run';
  if (!coverage) return 'partial';
  return coverage.missed_item_ids.length === 0 ? 'passed' : 'needs attention';
}

function shouldShowInspector(run: RunResponse): boolean {
  return taskFrameItemCount(run) > 0 || hasCheckerDetails(run) || hasMemoryDetails(run);
}

function hasCheckerDetails(run: RunResponse): boolean {
  return Boolean(run.coverage || (run.meta_signals && run.meta_signals.length > 0) || (run.answer_raw && run.answer_raw !== run.answer));
}

function hasMemoryDetails(run: RunResponse): boolean {
  const auditEntries = extractAuditEntries(run);
  return run.trace.length > 0 || auditEntryCount(run, auditEntries) > 0;
}

function buildThoughtMarkdown(run: RunResponse): string {
  if (run.reasoning_trace && run.reasoning_trace.trim()) {
    return run.reasoning_trace.trim();
  }

  const explanation = normalizeCopy(run.explanation);
  const answer = normalizeCopy(run.answer);
  if (explanation && explanation !== answer) return explanation;

  const traceHighlights = run.trace
    .map((entry) => traceHighlight(entry))
    .filter((value): value is string => Boolean(value))
    .slice(0, 12);
  if (traceHighlights.length > 0) {
    return traceHighlights.map((item) => `- ${item}`).join('\n');
  }

  const draft = normalizeCopy(run.answer_raw);
  if (draft && draft !== answer) return draft;

  const frame = run.task_frame_rendered?.trim();
  if (frame) {
    return `\`\`\`text\n${frame}\n\`\`\``;
  }

  return '';
}

function traceHighlight(entry: RunResponse['trace'][number]): string | null {
  const detail = normalizeCopy(entry.thought ?? entry.result?.summary ?? entry.error);
  const label = normalizeCopy([entry.phase, entry.action].filter(Boolean).join(' / '));
  if (label && detail) return `${humanize(label)}: ${detail}`;
  if (detail) return detail;
  if (label) return humanize(label);
  return null;
}

function streamStatusLabel(events: RunStreamEvent[], liveTokens: string): string {
  if (liveTokens.trim()) return 'streaming';
  const latest = [...events].reverse().find((event) => event.event !== 'token');
  if (!latest) return 'starting';
  return humanize(latest.event);
}

function extractAuditEntries(run: RunResponse): AuditEntry[] {
  const summary = run.substrate?.audit_summary;
  if (Array.isArray(summary)) return summary;
  if (summary && typeof summary === 'object' && Array.isArray(summary.entries)) {
    return summary.entries.filter((entry): entry is AuditEntry => Boolean(entry && typeof entry === 'object'));
  }
  return [];
}

function auditEntryCount(run: RunResponse, entries: AuditEntry[]): number {
  const summary = run.substrate?.audit_summary;
  if (Array.isArray(summary)) return summary.length;
  if (summary && typeof summary === 'object' && typeof summary.total_entries === 'number') {
    return summary.total_entries;
  }
  return entries.length;
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatDuration(value: number | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '1s';
  const totalSeconds = Math.max(1, Math.round(value));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function normalizeCopy(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
