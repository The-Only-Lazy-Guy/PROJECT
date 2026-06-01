import { useState, useMemo } from 'react';
import type { AuditEntry } from '../types';

export function AuditLogViewer(props: { entries?: AuditEntry[] | null }) {
  const [filterObject, setFilterObject] = useState('');
  const [filterOp, setFilterOp] = useState('');

  const entries = props.entries ?? [];

  const objectIds = useMemo(() => {
    const ids = new Set(entries.map((e) => e.object_id));
    return Array.from(ids).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterObject && e.object_id !== filterObject) return false;
      if (filterOp && e.operation !== filterOp) return false;
      return true;
    });
  }, [entries, filterObject, filterOp]);

  if (entries.length === 0) {
    return (
      <div className="audit-panel">
        <p className="microcopy">No audit log entries for this run.</p>
      </div>
    );
  }

  return (
    <div className="audit-panel">
      <h3>Mutation journal</h3>
      <div className="audit-filters">
        <select value={filterObject} onChange={(e) => setFilterObject(e.target.value)}>
          <option value="">All objects</option>
          {objectIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <select value={filterOp} onChange={(e) => setFilterOp(e.target.value)}>
          <option value="">All operations</option>
          <option value="create">create</option>
          <option value="read">read</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
        </select>
        <span className="microcopy">{filtered.length} entries</span>
      </div>
      <div className="audit-list">
        {filtered.map((entry, i) => (
          <div key={i} className={`audit-entry op-${entry.operation}`}>
            <div className="audit-entry-header">
              <span className={`audit-op op-${entry.operation}`}>{entry.operation}</span>
              <span className="audit-obj">{entry.object_id}</span>
              <span className="audit-step">step {entry.step_index}</span>
            </div>
            {entry.field_path && (
              <div className="audit-field">
                <code>{entry.field_path}</code>
              </div>
            )}
            {(entry.old_value !== undefined || entry.new_value !== undefined) && (
              <div className="audit-diff">
                {entry.old_value !== undefined && (
                  <div className="audit-diff-old">
                    <span className="diff-label">-</span>
                    <code>{JSON.stringify(entry.old_value)}</code>
                  </div>
                )}
                {entry.new_value !== undefined && (
                  <div className="audit-diff-new">
                    <span className="diff-label">+</span>
                    <code>{JSON.stringify(entry.new_value)}</code>
                  </div>
                )}
              </div>
            )}
            {entry.triggered_by_text && (
              <div className="audit-trigger">
                <span className="microcopy">Trigger: &ldquo;{entry.triggered_by_text}&rdquo;</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
