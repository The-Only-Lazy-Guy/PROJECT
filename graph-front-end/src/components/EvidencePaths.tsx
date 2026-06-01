import type { EvidencePath } from '../utils/graphLayout';

export function EvidencePathsPanel(props: {
  supportPaths: EvidencePath[];
  contradictPaths: EvidencePath[];
  dependencyPaths: EvidencePath[];
  bridgePaths: EvidencePath[];
  onSelect: (path: EvidencePath | null) => void;
  selectedId: string | null;
}) {
  const { supportPaths, contradictPaths, dependencyPaths, bridgePaths, onSelect, selectedId } = props;
  const hasAny = supportPaths.length + contradictPaths.length + dependencyPaths.length + bridgePaths.length > 0;

  if (!hasAny) {
    return (
      <div className="evidence-paths-panel">
        <p className="microcopy">No evidence paths extracted from this session.</p>
      </div>
    );
  }

  return (
    <div className="evidence-paths-panel">
      <h3>Evidence paths</h3>
      {supportPaths.length > 0 && (
        <PathGroup title="Support chains" paths={supportPaths} color="support" onSelect={onSelect} selectedId={selectedId} />
      )}
      {contradictPaths.length > 0 && (
        <PathGroup title="Contradiction chains" paths={contradictPaths} color="contradict" onSelect={onSelect} selectedId={selectedId} />
      )}
      {dependencyPaths.length > 0 && (
        <PathGroup title="Dependency chains" paths={dependencyPaths} color="dependency" onSelect={onSelect} selectedId={selectedId} />
      )}
      {bridgePaths.length > 0 && (
        <PathGroup title="Bridge paths" paths={bridgePaths} color="bridge" onSelect={onSelect} selectedId={selectedId} />
      )}
    </div>
  );
}

function PathGroup(props: {
  title: string;
  paths: EvidencePath[];
  color: string;
  onSelect: (path: EvidencePath | null) => void;
  selectedId: string | null;
}) {
  return (
    <div className="path-group-section">
      <span className={`path-group-label ${props.color}`}>{props.title} ({props.paths.length})</span>
      <div className="path-group-cards">
        {props.paths.slice(0, 10).map((path) => (
          <button
            key={path.id}
            className={`path-item ${props.color} ${props.selectedId === path.id ? 'active' : ''}`}
            onClick={() => props.onSelect(props.selectedId === path.id ? null : path)}
          >
            <div className="path-item-nodes">
              {path.nodes.slice(0, 5).map((nid, i) => (
                <span key={nid}>
                  {i > 0 && <span className="path-arrow"> &rarr; </span>}
                  <code>{nid}</code>
                </span>
              ))}
              {path.nodes.length > 5 && <span className="path-more"> +{path.nodes.length - 5} more</span>}
            </div>
            <div className="path-item-meta">
              <span className="path-score">{(path.score * 100).toFixed(0)}%</span>
              <span className="microcopy">{path.edges.length} edges</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
