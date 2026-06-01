import { useState } from 'react';
import type { RunStreamEvent } from '../types';
import { LiveSessionGraph } from './LiveSessionGraph';
import { MarkdownContent } from './MarkdownContent';

export function ReasoningBlock(props: { liveText: string; events: RunStreamEvent[]; question: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="reasoning-block">
      <button
        type="button"
        className={`thinking-toggle ${expanded ? 'expanded' : ''}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="thinking-toggle-copy">
          <span className="thinking-toggle-title">Thinking...</span>
          <span className="thinking-toggle-hint">
            {expanded ? 'Hide live stream' : 'Show live stream'}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="live-reasoning-grid">
          <LiveSessionGraph events={props.events} question={props.question} />
          <div className="live-token-card">
            {props.liveText ? (
              <div className="token-stream">
                <MarkdownContent text={props.liveText} className="live-markdown" />
              </div>
            ) : (
              <p className="thinking-placeholder">Waiting for live tokens...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
