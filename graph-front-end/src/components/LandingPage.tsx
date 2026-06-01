import { useState } from 'react';
import type { HealthResponse } from '../types';
import { ScrollReveal } from './ScrollReveal';
import { InteractiveGraphBg } from './InteractiveGraphBg';
import { InteractiveToyGraph, NodeData } from './InteractiveToyGraph';
import { ThemeToggle, useTheme } from './ThemeToggle';
import './Overview.css'; // Premium V4 styling

type Props = {
  health: HealthResponse | null;
  onStart: () => void;
};

export function LandingPage({ health, onStart }: Props) {
  const { theme, toggle } = useTheme();
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const runtimeOk = Boolean(health?.runtime?.ok || health?.opencode?.ok);

  return (
    <div className="landing-page premium-overview" style={{ minHeight: '100vh', padding: 0 }}>
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>
      <div className="bg-glow bg-glow-3"></div>

      <header className="landing-header premium-glass" style={{ margin: '1rem 2rem', borderRadius: '20px', padding: '1rem 2rem' }}>
        <div className="landing-logo">
          <div className="brand-mark" style={{ width: 32, height: 32 }} />
          <strong className="gradient-text">Graph Agent V4</strong>
        </div>
        <div className="landing-controls">
          <span className={`status-pill glass-badge ${runtimeOk ? 'ok' : 'error'}`}>
            <i /> {runtimeOk ? 'V4 Engine Online' : 'Engine Offline'}
          </span>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
      </header>

      <section className="landing-hero" style={{ paddingTop: '2rem' }}>
        <InteractiveGraphBg />
        <div className="landing-hero-content premium-glass" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <ScrollReveal animation="fade-up" duration={800}>
            <div className="landing-badge glass-badge highlight" style={{ marginBottom: '1.5rem', display: 'inline-block' }}>Backend Reasoning Environment</div>
            <h1 className="landing-title gradient-text" style={{ fontSize: '3.5rem', lineHeight: '1.1' }}>
              Safe, Auditable, and Effective <br />
              <span>Graph Use</span>
            </h1>
            <p className="landing-subtitle hero-subtitle" style={{ margin: '1.5rem auto' }}>
              V4 is the backend answerer designed to collect high-quality behavior from opencode.
              It features a <b>Micro Epistemic Controller</b> to force fast finalization paths,
              enforces graph-read requirements, and extracts knowledge securely via <b>Scoped Edit Patches</b>.
            </p>
            <div className="landing-cta" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem' }}>
              <button className="primary-cta btn-glow-primary" onClick={onStart}>
                Launch V4 Chat Lab
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 8 }}>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>

            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '3rem' }}>
              <div className="stat-card glass-panel-inner">
                <h3 className="gradient-text" style={{ fontSize: '2rem', margin: 0 }}>65%</h3>
                <p style={{ fontSize: '0.8rem', color: '#94A3B8', textTransform: 'uppercase' }}>Architecture</p>
              </div>
              <div className="stat-card glass-panel-inner">
                <h3 className="gradient-text" style={{ fontSize: '2rem', margin: 0 }}>80%</h3>
                <p style={{ fontSize: '0.8rem', color: '#94A3B8', textTransform: 'uppercase' }}>Signature Track</p>
              </div>
              <div className="stat-card glass-panel-inner">
                <h3 className="gradient-text" style={{ fontSize: '2rem', margin: 0 }}>-5.54s</h3>
                <p style={{ fontSize: '0.8rem', color: '#94A3B8', textTransform: 'uppercase' }}>Live Bias Delta</p>
              </div>
              <div className="stat-card glass-panel-inner">
                <h3 className="gradient-text" style={{ fontSize: '2rem', margin: 0 }}>3</h3>
                <p style={{ fontSize: '0.8rem', color: '#94A3B8', textTransform: 'uppercase' }}>Live-bias Uses</p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section className="landing-features" style={{ padding: '6rem 2rem', position: 'relative', zIndex: 2 }}>
        <div className="landing-container" style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '4rem' }}>

          <ScrollReveal animation="fade-up" delay={100}>
            <div className="feature-row premium-glass hover-glow" style={{ display: 'flex', gap: '3rem', alignItems: 'center' }}>
              <div className="feature-text" style={{ flex: 1 }}>
                <div className="text-accent" style={{ marginBottom: '0.5rem' }}>Core Execution</div>
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Micro Epistemic Controller</h2>
                <p style={{ color: '#94A3B8', fontSize: '1.1rem', lineHeight: 1.6 }}>
                  Operating at semantic subgoal granularity, the controller uses rules-first
                  knownness checks and slot sufficiency masks. It intelligently recommends <b>FINALIZE</b>
                  when required slots are filled, bypassing full multi-turn LLM loops.
                  When fallback is needed, it uses explicit <code>&lt;graph_action&gt;</code> blocks.
                </p>
              </div>
              <div className="feature-visual" style={{ flex: 1 }}>
                <div className="glass-panel-inner" style={{ padding: '2rem' }}>
                  <pre style={{ margin: 0, color: '#E2E8F0', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
<code>{`task_family: direct_judgment
required_slots: [answer, reason]
filled_slots: [answer, reason]

action: FINALIZE
> Executes one-shot finalize path`}</code>
                  </pre>
                </div>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal animation="fade-up" delay={100}>
            <div className="feature-row reverse toy-row premium-glass hover-glow" style={{ display: 'flex', gap: '3rem', alignItems: 'center', flexDirection: 'row-reverse' }}>
              <div className="feature-text" style={{ flex: 1 }}>
                <div className="text-accent" style={{ marginBottom: '0.5rem' }}>Visual Interface</div>
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Dynamic Topology</h2>
                {hoveredNode ? (
                  <div className="dynamic-hover-text" style={{ animation: 'fadeInUp 0.3s var(--ease-out)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                      <span className="glass-badge highlight" style={{ padding: '6px 14px', borderRadius: 99, fontSize: '0.9rem' }}>
                        {hoveredNode.label} Node
                      </span>
                      <span className="glass-badge" style={{ padding: '6px 14px', borderRadius: 99, fontSize: '0.9rem' }}>
                        {hoveredNode.edgeCount} Edges
                      </span>
                    </div>
                    <p style={{ color: '#F8FAFC' }}>{hoveredNode.desc}</p>
                    <p style={{ fontSize: '0.9rem', fontStyle: 'italic', marginTop: 12, color: '#94A3B8' }}>"{hoveredNode.text}"</p>
                  </div>
                ) : (
                  <p style={{ color: '#94A3B8', fontSize: '1.1rem', lineHeight: 1.6, animation: 'fadeInUp 0.3s var(--ease-out)' }}>
                    Instead of a single retrieval dump, the graph becomes a live workspace.
                    The agent builds a session graph—adding nodes, drawing edges, and recording
                    hypotheses—until an answer emerges from the structure it has built.
                    <br/><br/>
                    <em style={{ color: '#3B82F6' }}>Hover and drag the nodes to explore the interactive widget.</em>
                  </p>
                )}
              </div>
              <div className="feature-visual toy-visual" style={{ flex: 1.2 }}>
                <InteractiveToyGraph onHoverNode={setHoveredNode} />
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal animation="fade-up" delay={100}>
            <div className="feature-row premium-glass hover-glow" style={{ display: 'flex', gap: '3rem', alignItems: 'center' }}>
              <div className="feature-text" style={{ flex: 1 }}>
                <div className="text-accent" style={{ marginBottom: '0.5rem' }}>Graph Learning</div>
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Scoped Patches & Signature Memory</h2>
                <p style={{ color: '#94A3B8', fontSize: '1.1rem', lineHeight: 1.6 }}>
                  Graph edits go through a non-mutating validation layer (<code>accept</code>, <code>soft_only</code>, <code>needs_review</code>).
                  The Signature Memory tracks explicit sibling-variant relations: <b>overlaps</b>, <b>entails</b>, and <b>contradicts</b>.
                  Live anchor bias is selectively applied, optimizing for helpfulness while avoiding unneeded latency on already-strong baselines.
                </p>
              </div>
              <div className="feature-visual" style={{ flex: 1 }}>
                <div className="glass-panel-inner" style={{ padding: '2rem' }}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <li style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}><span style={{ color: '#10B981', fontWeight: 'bold' }}>✓</span> <span>Selective Live Bias Gating</span></li>
                    <li style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}><span style={{ color: '#10B981', fontWeight: 'bold' }}>✓</span> <span>Bounded Score Propagation</span></li>
                    <li style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}><span style={{ color: '#10B981', fontWeight: 'bold' }}>✓</span> <span>Contested-Family Detection</span></li>
                    <li style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}><span style={{ color: '#10B981', fontWeight: 'bold' }}>✓</span> <span>GMeLLo-inspired Edit Proposals</span></li>
                  </ul>
                </div>
              </div>
            </div>
          </ScrollReveal>

        </div>
      </section>

      <footer className="landing-footer" style={{ textAlign: 'center', padding: '4rem 2rem', borderTop: '1px solid rgba(255,255,255,0.05)', position: 'relative', zIndex: 2 }}>
        <ScrollReveal animation="fade-up">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem' }}>Ready to test V4?</h2>
          <button className="primary-cta btn-glow-primary" style={{ padding: '1rem 3rem', fontSize: '1.2rem' }} onClick={onStart}>
            Enter the Lab
          </button>
        </ScrollReveal>
      </footer>
    </div>
  );
}
