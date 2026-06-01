import type { GraphSummary, HealthResponse, RunRequest } from '../types';
import { ThemeToggle } from './ThemeToggle';

type Settings = {
  k_anchors: number;
  anchor_strategy: RunRequest['anchor_strategy'];
};

export function Sidebar(props: {
  page: string;
  onPageChange: (page: 'overview' | 'chat') => void;
  graphs: GraphSummary[];
  selectedGraph: string;
  onGraphChange: (id: string) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  health: HealthResponse | null;
  onRefresh: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  const { page, onPageChange, graphs, selectedGraph, onGraphChange, settings, onSettingsChange, health, onRefresh, theme, onToggleTheme } = props;
  const selected = graphs.find((g) => g.id === selectedGraph);
  const info = health?.runtime ?? health?.opencode ?? null;
  const runtimeOk = Boolean(info?.ok);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" />
        <div>
          <strong>Graph-Agent</strong>
          <span>Graph reasoning interface</span>
        </div>
      </div>

      <nav className="nav">
        <button className={page === 'overview' ? 'active' : ''} onClick={() => onPageChange('overview')}>
          Overview
        </button>
        <button className={page === 'chat' ? 'active' : ''} onClick={() => onPageChange('chat')}>
          Chat Lab
        </button>
      </nav>

      <section className="panel compact">
        <div className="section-title">Prompt setup</div>
        <label>
          Graph
          <select value={selectedGraph} onChange={(e) => onGraphChange(e.target.value)}>
            {graphs.map((g) => (
              <option key={g.id} value={g.id}>{g.file}</option>
            ))}
          </select>
        </label>
        {selected && (
          <div className="microcopy">
            {selected.nodes ?? 0} nodes &middot; {selected.edges ?? 0} edges
          </div>
        )}
        <label>
          Anchor strategy
          <select
            value={settings.anchor_strategy}
            onChange={(e) => onSettingsChange({ ...settings, anchor_strategy: e.target.value as Settings['anchor_strategy'] })}
          >
            <option value="topk">topk</option>
            <option value="mmr">mmr</option>
            <option value="legacy">legacy</option>
          </select>
        </label>
        <label>
          <span className="label-row">
            Anchors
            <b>{settings.k_anchors}</b>
          </span>
          <input
            type="range" min={3} max={16} step={1}
            value={settings.k_anchors}
            onChange={(e) => onSettingsChange({ ...settings, k_anchors: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel compact">
        <div className="section-title">Server Status</div>
        <div className="status-row">
          <span className={`status-dot ${runtimeOk ? 'ok' : 'bad'}`} />
          <div>
            <strong>Server Status</strong>
            <span>{info ? `${info.latency_ms} ms health check` : 'Checking status'}</span>
          </div>
        </div>
        {info?.version && <p className="microcopy">{info.version}</p>}
        {info?.error && <p className="microcopy">{info.error}</p>}
        <p className="microcopy">Reasoning mode: {health?.reasoning_mode ?? 'legacy'}</p>
        <button className="secondary" onClick={onRefresh}>Refresh status</button>
      </section>

      <div className="sidebar-footer" style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="microcopy" style={{ opacity: 0.6 }}>v4.0.0</span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </aside>
  );
}
