import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HealthResponse, GraphSummary } from '../types';
import { ArchitectureDiagram } from './ArchitectureDiagram';
import { ScrollReveal } from './ScrollReveal';
import './Overview.css'; // We'll add this file for premium styling

const LOOP = 12;
const TL = {
  question:   [0.0,  1.4],
  retrieve:   [1.4,  2.4],
  spawnCtx:   [2.4,  3.3],
  reason1:    [3.3,  4.5],
  callCheck:  [4.5,  5.5],
  failHit:    [5.5,  6.4],
  proposeAlt: [6.4,  7.6],
  reason2:    [7.6,  8.6],
  answer:     [8.6, 10.4],
  consol:     [10.4, 11.4],
  hold:       [11.4, 12.0],
};
const PHASES = [
  { id: 'retrieve',  label: 'Retrieve',    at: TL.retrieve[0],   color: '#6d665d' },
  { id: 'spawn',     label: 'Spawn ctx',   at: TL.spawnCtx[0],   color: '#6b3fa0' },
  { id: 'verify',    label: 'Verify',      at: TL.callCheck[0],  color: '#4f7661' },
  { id: 'failure',   label: 'Failure',     at: TL.failHit[0],    color: '#ba4f45' },
  { id: 'propose',   label: 'Propose',     at: TL.proposeAlt[0], color: '#c46a3d' },
  { id: 'answer',    label: 'Answer',      at: TL.answer[0],     color: '#4f7661' },
  { id: 'consolidate', label: 'Consolidate', at: TL.consol[0],  color: '#9b9286' },
];

function phaseAt(t: number) {
  let idx = -1;
  for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i].at) idx = i;
  return idx;
}

const NODES: Record<string, { x: number; y: number; r: number; label: string; sub: string; kind: string; born: number }> = {
  q:    { x:  90, y: 220, r: 28, label: 'Q',       sub: 'question',       kind: 'q',     born: TL.question[1] - 0.4 },
  a1:   { x: 230, y: 110, r: 22, label: 'Dij',     sub: 'fact',           kind: 'fact',  born: TL.retrieve[0] + 0.10 },
  a2:   { x: 240, y: 220, r: 22, label: 'SP',      sub: 'fact',           kind: 'fact',  born: TL.retrieve[0] + 0.25 },
  a3:   { x: 230, y: 330, r: 22, label: 'EW',      sub: 'fact',           kind: 'fact',  born: TL.retrieve[0] + 0.40 },
  ctx:  { x: 410, y: 220, r: 32, label: 'ctx#1',   sub: 'session_object', kind: 'proc',  born: TL.spawnCtx[0] + 0.10 },
  chk:  { x: 555, y: 120, r: 24, label: 'check',   sub: 'call',           kind: 'call',  born: TL.callCheck[0] + 0.05 },
  fail: { x: 555, y: 330, r: 28, label: '!',       sub: 'failure_pattern',kind: 'fail',  born: TL.failHit[0] + 0.05 },
  alt:  { x: 705, y: 230, r: 28, label: 'BF',      sub: 'procedure',      kind: 'alt',   born: TL.proposeAlt[0] + 0.10 },
  ans:  { x: 850, y: 220, r: 32, label: 'A',       sub: 'answer',         kind: 'ans',   born: TL.answer[0] + 0.30 },
};

const EDGES = [
  { id: 'e1', from: 'q', to: 'a1', born: TL.retrieve[0] + 0.20, kind: 'retrieve' as const },
  { id: 'e2', from: 'q', to: 'a2', born: TL.retrieve[0] + 0.30, kind: 'retrieve' as const },
  { id: 'e3', from: 'q', to: 'a3', born: TL.retrieve[0] + 0.45, kind: 'retrieve' as const },
  { id: 'e4', from: 'a2', to: 'ctx', born: TL.spawnCtx[0] + 0.35, kind: 'derive' as const, label: 'depends_on' },
  { id: 'e5', from: 'ctx', to: 'chk', born: TL.callCheck[0] + 0.20, kind: 'call' as const, label: 'calls' },
  { id: 'e6', from: 'chk', to: 'fail', born: TL.failHit[0] + 0.10, kind: 'fail' as const, label: 'matches' },
  { id: 'e7', from: 'fail', to: 'alt', born: TL.proposeAlt[0] + 0.30, kind: 'alt' as const, label: 'replaced_by' },
  { id: 'e8', from: 'alt', to: 'ans', born: TL.answer[0] + 0.25, kind: 'answer' as const },
  { id: 'e9', from: 'ctx', to: 'ans', born: TL.answer[0] + 0.50, kind: 'cite' as const, dashed: true, label: 'cited' },
];

const KIND_COLORS: Record<string, string> = {
  q: '#8B5CF6', fact: '#64748B', proc: '#10B981', call: '#10B981',
  fail: '#EF4444', alt: '#F59E0B', ans: '#3B82F6',
};
const EDGE_COLORS: Record<string, string> = {
  retrieve: '#64748B', derive: '#10B981', call: '#10B981',
  fail: '#EF4444', alt: '#F59E0B', answer: '#3B82F6', cite: '#64748B',
};

function focusedAt(t: number) {
  let cur = 0;
  for (let i = 0; i < EDGES.length; i++) if (t >= EDGES[i].born) cur = i;
  return EDGES[cur]?.from ?? 'q';
}

function curvedPath(ax: number, ay: number, bx: number, by: number, bow = 18) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const cx = (ax + bx) / 2 + (dy / len) * bow;
  const cy = (ay + by) / 2 - (dx / len) * bow;
  return { d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`, cx, cy };
}

const DEFS: Record<string, string> = {
  'micro epistemic controller': 'Operates at semantic subgoal granularity. Recommends FINALIZE when required slots are filled, avoiding LLM loops.',
  'scoped edit patches': 'Proposed graph edits are mapped to accept, soft_only, needs_review, or reject, preventing dangerous mutations.',
  'signature memory': 'Stores memory nodes with explicit variant relations: overlaps, entails, and contradicts.',
  'live bias': 'Selective anchor bias that optimizes for helpfulness, prepending direct-judgment anchor nodes carefully.',
  'anchor retrieval': 'A similarity search that pulls the most relevant memory nodes from the long-term graph to seed the session.',
  'session graph': 'A temporary working graph created per query. Holds question, evidence, hypotheses, procedure state, and conclusions.',
  'stateful procedure': 'A reusable reasoning template that carries mutable state across steps within a session.',
  'evidence path': 'A chain of nodes and edges that forms a structured argument — support chain or contradiction chain.',
};

type HoverDefProps = { term: string; children: React.ReactNode };
function Def({ term, children }: HoverDefProps) {
  const def = DEFS[term.toLowerCase()];
  return (
    <span className="def-term" data-def={def || term}>
      {children}
      {def && <span className="def-popup">{def}</span>}
    </span>
  );
}

export function Overview(props: {
  health: HealthResponse | null;
  graphs: GraphSummary[];
  onStart: () => void;
}) {
  const { health, graphs, onStart } = props;
  const runtime = health?.runtime ?? health?.opencode;
  const runtimeOk = runtime?.ok ?? false;

  return (
    <div className="overview premium-overview">
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>
      <div className="bg-glow bg-glow-3"></div>

      <ScrollReveal animation="fade-up">
        <section className="hero-reasoning premium-glass">
          <div className="eyebrow">Backend Reasoning Environment</div>
          <h1 className="gradient-text">Safe, Auditable, & Effective Graph Use.</h1>
          <p className="hero-subtitle">
            The V4 architecture turns opencode trajectories into a pristine local reasoner.
            It leverages the <Def term="Micro Epistemic Controller">Micro Epistemic Controller</Def> to force fast finalization
            paths, enforces graph-read requirements, and securely extracts knowledge via <Def term="Scoped Edit Patches">Scoped Edit Patches</Def>.
          </p>
          <div className="hero-actions">
            <button className="btn-glow-primary" onClick={onStart}>Launch Chat Lab</button>
            <span className="hero-stat glass-badge">v4 Engine Active</span>
            <span className="hero-stat glass-badge highlight">80% Signature Progress</span>
            <span className="hero-stat glass-badge server ok">-5.54s Elapsed Delta</span>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal delay={100} animation="fade-up">
        <section className="live-demo premium-glass">
          <div className="section-label text-accent">Live reasoning preview</div>
          <h2>Watch the graph build itself as the model reasons.</h2>
          <AnimatedSessionExample />
        </section>
      </ScrollReveal>

      <ScrollReveal delay={200} animation="fade-up">
        <section className="how-it-works">
          <div className="section-label text-accent">How reasoning works in V4</div>
          <h2>The micro-controller driven pipeline.</h2>
          <div className="reasoning-steps">
            <ReasoningStep number={1} title="Query & Local Working Memory" detail="Builds working memory from anchors and compatible nodes. Includes candidate facts, strategies, and filled slot values." example={<div className="step-example-graph"><span className="ex-node question">Q: Is Dijkstra valid if edges are negative?</span><div className="step-audit-hint"><code>task_family: algorithm_applicability</code></div></div>} anim="fadeInUp 0.4s ease both" />
            <ReasoningStep number={2} title="Micro Epistemic Controller" detail="Operates at subgoal granularity. Checks knownness and slot sufficiency. Recommends FINALIZE when all required slots are filled, avoiding the full tool loop." example={<div className="step-example-graph"><span className="ex-node procedure">Subgoal: verdict, reason, caveat</span><div className="step-audit-hint"><code>action: FINALIZE</code></div></div>} anim="fadeInUp 0.4s ease 0.15s both" />
            <ReasoningStep number={3} title="LLM Tool Executor Fallback" detail="If slots aren't filled, falls back to a loop using <graph_action> blocks. Guaranteed to execute read_node before answering." example={<div className="step-example-graph"><span className="ex-node session-object">action: read_node(id="shortest_path.dijkstra")</span></div>} anim="fadeInUp 0.4s ease 0.3s both" />
            <ReasoningStep number={4} title="Graph Safety & Scoped Patches" detail="Post-processing extracts deterministic learning. Scoped patches type edits (add_fact, add_strategy) and validate them (accept, soft_only, needs_review)." example={<div className="step-example-graph"><span className="ex-node evidence">patch: add_solved_subgoal</span><div className="step-audit-hint"><code>status: needs_review</code></div></div>} anim="fadeInUp 0.4s ease 0.45s both" />
            <ReasoningStep number={5} title="Signature Memory & Relations" detail="Stores explicit sibling-variant relations (overlaps, entails, contradicts) to detect contested families and bound score propagation." example={<div className="step-example-graph"><div className="path-vis support-path"><span className="pv-node">Variant A</span><span className="pv-label">contradicts</span><span className="pv-node">Variant B</span></div></div>} anim="fadeInUp 0.4s ease 0.6s both" />
            <ReasoningStep number={6} title="Selective Live Bias" detail="Uses shadow-ranked signature memory to provide an anchor-bias hint, but safely gates out strong baseline direct judgments to prevent latency spikes." example={<div className="step-example-graph"><span className="ex-node conclusion">Bias Applied: Only for ambiguous multi-support matches</span></div>} anim="fadeInUp 0.4s ease 0.75s both" />
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal delay={300} animation="fade-up">
        <section className="arch-section premium-glass">
          <div className="section-label text-accent">System architecture</div>
          <h2>Transformer + graph: the seam between fluid inference and persistent structure.</h2>
          <ArchitectureDiagram />
          <div className="arch-split-grid">
            <div className="arch-split-card glass-panel-inner">
              <div className="split-heading">Micro-Controller & Fallback</div>
              <ul className="split-list">
                <li>Rules-first subgoal knownness</li>
                <li>One-shot finalizer routing</li>
                <li>Plain-text &lt;graph_action&gt; execution</li>
                <li>Mandatory evidence reads</li>
              </ul>
            </div>
            <div className="arch-split-card glass-panel-inner">
              <div className="split-heading">Learning & Extraction</div>
              <ul className="split-list">
                <li>Scoped patch validation</li>
                <li>Signature shadow reranking</li>
                <li>Explicit sibling relation typing</li>
                <li>Non-mutating GMeLLo-inspired proposals</li>
              </ul>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal delay={400} animation="fade-up">
        <section className="glossary-section premium-glass">
          <div className="section-label text-accent">V4 Key concepts</div>
          <h2>Terms defining the updated reasoning substrate.</h2>
          <div className="glossary-grid">
            {Object.entries(DEFS).map(([term, def]) => (
              <div key={term} className="glossary-card hover-glow">
                <strong>{term}</strong>
                <p>{def}</p>
              </div>
            ))}
          </div>
        </section>
      </ScrollReveal>
    </div>
  );
}

function ReasoningStep(props: {
  number: number; title: string; detail: string; example: ReactNode; anim: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`reasoning-step premium-step ${expanded ? 'expanded' : ''}`} style={{ animation: props.anim } as React.CSSProperties}>
      <div className="step-header" onClick={() => setExpanded(!expanded)}>
        <span className="step-number gradient-bg">{props.number}</span>
        <div className="step-text">
          <span className="step-title">{props.title}</span>
          <p className="step-detail">{props.detail}</p>
        </div>
        <span className={`step-toggle ${expanded ? 'open' : ''}`}>&#9660;</span>
      </div>
      {expanded && <div className="step-example premium-example">{props.example}</div>}
    </div>
  );
}

function AnimatedSessionExample() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const lastRef = useRef(0);

  const adj = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const id of Object.keys(NODES)) m[id] = new Set([id]);
    for (const e of EDGES) { m[e.from].add(e.to); m[e.to].add(e.from); }
    return m;
  }, []);

  const [hovered, setHovered] = useState<string | null>(null);
  const highlight = hovered;
  const dimNode = (id: string) => highlight && !adj[highlight]?.has(id);
  const dimEdge = (e: typeof EDGES[number]) => highlight && !(e.from === highlight || e.to === highlight);

  useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        return next >= LOOP ? 0 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const curPhase = phaseAt(t);
  const curPhaseLabel = curPhase >= 0 ? PHASES[curPhase].label : 'idle';
  const curPhaseColor = curPhase >= 0 ? PHASES[curPhase].color : '#94A3B8';

  return (
    <div className="session-example premium-session-example">
      <div className="example-live-header">
        <div className="example-live-dot" style={{ background: curPhaseColor, boxShadow: `0 0 10px ${curPhaseColor}` }} />
        <span className="example-live-label">reasoning · {curPhaseLabel}</span>
        <span className="example-live-time">t+{t.toFixed(1)}s</span>
      </div>

      <div className="example-phase-bar">
        <div className="example-phase-rail" />
        <div className="example-phase-fill" style={{ width: `${(t / LOOP) * 100}%`, background: `linear-gradient(90deg, transparent, ${curPhaseColor})` }} />
        <div className="example-phase-markers">
          {PHASES.map((p) => {
            const reached = t >= p.at;
            const isCurrent = phaseAt(t) === PHASES.indexOf(p);
            return (
              <div key={p.id} className="example-phase-marker" style={{ left: `${(p.at / LOOP) * 100}%` }}>
                <span className={`example-phase-label ${isCurrent ? 'active' : ''} ${reached ? 'reached' : ''}`}>{p.label}</span>
                <span className={`example-phase-dot ${isCurrent ? 'active' : ''} ${reached ? 'reached' : ''}`} style={{ borderColor: p.color, background: reached ? p.color : 'transparent', boxShadow: isCurrent ? `0 0 8px ${p.color}` : 'none' }} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="example-graph-area">
        <div className="example-graph-dots" />
        <svg viewBox="0 0 920 440" className="example-live-svg" preserveAspectRatio="xMidYMid meet"
          onClick={(e) => { if ((e.target as SVGElement).tagName === 'svg') setHovered(null); }}>
          <defs>
            <filter id="ex-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {EDGES.map((e) => {
            const A = NODES[e.from], B = NODES[e.to];
            if (t < e.born) return null;
            const draw = Math.min(1, (t - e.born) / 0.5);
            if (draw === 0) return null;
            const color = EDGE_COLORS[e.kind] || '#94A3B8';
            const dx = B.x - A.x, dy = B.y - A.y;
            const dist = Math.hypot(dx, dy);
            const t1 = A.r / dist, t2 = (dist - B.r) / dist;
            const ax = A.x + dx * t1, ay = A.y + dy * t1;
            const bx = A.x + dx * t2, by = A.y + dy * t2;
            const { d, cx, cy } = curvedPath(ax, ay, bx, by, e.kind === 'cite' ? 0 : 22);
            const isDim = dimEdge(e);
            const pathLen = Math.hypot(bx - ax, by - ay) + 30;
            const dashOffset = pathLen * (1 - draw);
            const reasonActive = t >= e.born && t < e.born + 0.8;
            return (
              <g key={e.id} style={{ opacity: isDim ? 0.15 : 1, transition: 'opacity 280ms ease' }}>
                {reasonActive && <path d={d} fill="none" stroke={color} strokeWidth="6" opacity="0.4" filter="url(#ex-glow)" />}
                <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset} style={{ transition: 'stroke-dashoffset 350ms ease' }} />
                {(t - e.born) < 1.0 && draw > 0.1 && (
                  <circle r="4" fill={color} filter="url(#ex-glow)">
                    <animateMotion dur="0.85s" repeatCount="1" keyTimes="0;1" keySplines="0.2 0.7 0.2 1" calcMode="spline" path={d} />
                    <animate attributeName="opacity" values="0;1;1;0" dur="0.85s" repeatCount="1" />
                  </circle>
                )}
                {e.label && draw > 0.6 && (
                  <g style={{ opacity: isDim ? 0 : 0.95, transition: 'opacity 220ms' }}>
                    <rect x={cx - e.label.length * 3.5} y={cy - 8} width={e.label.length * 7} height={16} rx={6} fill="#0F172A" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                    <text x={cx} y={cy + 3} textAnchor="middle" fontFamily="monospace" fontSize="9" fill="#F8FAFC">{e.label}</text>
                  </g>
                )}
              </g>
            );
          })}
          {Object.entries(NODES).map(([id, n]) => {
            if (t < n.born) return null;
            const grow = Math.min(1, (t - n.born) / 0.45);
            if (grow === 0) return null;
            const color = KIND_COLORS[n.kind] || '#64748B';
            const isDim = dimNode(id);
            const scale = grow < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - grow, 3)) + Math.sin(grow * Math.PI) * 0.08 : 1;
            const isFocus = focusedAt(t) === id && t >= n.born && t < n.born + 6;
            const isHover = hovered === id;
            return (
              <g key={id} transform={`translate(${n.x} ${n.y}) scale(${scale})`}
                style={{ cursor: 'pointer', opacity: isDim ? 0.25 : 1, transition: 'opacity 280ms ease' }}
                onMouseEnter={() => setHovered(id)}
                onMouseLeave={() => setHovered(null)}>
                {(isFocus || isHover) && (
                  <circle r={n.r + 14} fill="none" stroke={color} strokeWidth={isHover ? 2 : 1} opacity={isHover ? 0.8 : 0.5} filter="url(#ex-glow)">
                    {isFocus && <animate attributeName="r" values={`${n.r + 8};${n.r + 20};${n.r + 8}`} dur="2.2s" repeatCount="indefinite" />}
                  </circle>
                )}
                <circle r={n.r} fill={`color-mix(in srgb, ${color} 20%, #0F172A)`} stroke={color} strokeWidth="2" filter={isHover ? 'url(#ex-glow)' : undefined} />
                <circle r={n.r - 4} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                <text textAnchor="middle" y={n.label.length > 2 ? 2 : 4} fontFamily={n.label.length > 2 ? 'monospace' : 'system-ui'} fontWeight={n.label.length > 2 ? 600 : 700} fontSize={n.label.length > 2 ? 11 : 16} fill="#F8FAFC">{n.label}</text>
                {grow > 0.7 && <text textAnchor="middle" y={n.r + 16} fontFamily="monospace" fontSize="9" fill="#94A3B8" letterSpacing="0.08em">{n.sub}</text>}
              </g>
            );
          })}
        </svg>

        <div className="example-graph-badge">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: '#10B981', animation: 'pulse-soft 1.4s ease-in-out infinite', boxShadow: '0 0 6px #10B981' }} />
          session subgraph · live
        </div>
        <div className="example-graph-stats">
          <span><b style={{ color: '#10B981' }}>{Object.values(NODES).filter((n) => t >= n.born).length}</b> nodes</span>
          <span><b style={{ color: '#10B981' }}>{EDGES.filter((e) => t >= e.born).length}</b> edges</span>
        </div>
        <div className="example-graph-legend">
          {[['q','question','#8B5CF6'],['fact','fact','#64748B'],['proc','procedure','#10B981'],['fail','failure','#EF4444'],['alt','alternate','#F59E0B'],['ans','answer','#3B82F6']].map(([k, l, c]) => (
            <span key={k}><i style={{ background: `${c}` }} />{l}</span>
          ))}
        </div>
        <div className="example-graph-hints">
          <span><b>hover</b> chain</span>
          <span><b>scrub</b> rewind</span>
        </div>
      </div>

      <div className="example-transport">
        <button className="ex-transport-btn primary glow-btn" onClick={() => setPlaying(!playing)}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="#fff" /><rect x="8" y="2" width="3" height="10" fill="#fff" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2 L12 7 L3 12 Z" fill="#fff" /></svg>
          )}
        </button>
        <button className="ex-transport-btn" onClick={() => setT(0)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#F8FAFC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7 a5 5 0 1 0 1.4 -3.5" /><path d="M2 2 v3 h3" /></svg>
        </button>
        <span className="ex-transport-time">{t.toFixed(1)}s / {LOOP.toFixed(0)}s</span>
        <input type="range" className="ex-scrubber" min={0} max={LOOP} step={0.05} value={t} onChange={(e) => setT(Number(e.target.value))} />
        <div className="ex-speed-group">
          {[0.5, 1, 2].map((s) => (
            <button key={s} className={`ex-speed-btn ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
