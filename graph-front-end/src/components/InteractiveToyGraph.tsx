import { useState, useRef, useEffect, MouseEvent as ReactMouseEvent } from 'react';

const NODE_TYPES = [
  {
    id: 'q1',
    type: 'question',
    label: 'Question',
    text: 'Can light travel in a vacuum?',
    initialX: 12, initialY: 40,
    desc: 'The initial trigger. Represents the user query or sub-goal.'
  },
  {
    id: 'p1',
    type: 'procedure',
    label: 'Procedure',
    text: 'SearchMemory("light medium")',
    initialX: 35, initialY: 15,
    desc: 'An active tool invocation or reasoning step taken by the agent.'
  },
  {
    id: 'e1',
    type: 'evidence',
    label: 'Evidence',
    text: 'Light is an electromagnetic wave.',
    initialX: 35, initialY: 65,
    desc: 'An immutable fact retrieved from long-term memory or external tools.'
  },
  {
    id: 'h1',
    type: 'hypothesis',
    label: 'Hypothesis',
    text: 'EM waves do not need a medium.',
    initialX: 62, initialY: 40,
    desc: 'A tentative claim proposed by the agent that requires verification.'
  },
  {
    id: 'o1',
    type: 'session-object',
    label: 'State Object',
    text: '{ verified: true }',
    initialX: 62, initialY: 80,
    desc: 'Mutable memory representing the agent’s ongoing contextual state.'
  },
  {
    id: 'c1',
    type: 'conclusion',
    label: 'Conclusion',
    text: 'Yes, it travels in a vacuum.',
    initialX: 88, initialY: 40,
    desc: 'The final, grounded output derived from verified evidence paths.'
  }
];

const EDGES = [
  { from: 'q1', to: 'p1', label: 'triggers' },
  { from: 'q1', to: 'e1', label: 'context' },
  { from: 'p1', to: 'h1', label: 'proposes' },
  { from: 'e1', to: 'h1', label: 'supports', color: 'var(--sage)' },
  { from: 'h1', to: 'o1', label: 'mutates' },
  { from: 'h1', to: 'c1', label: 'yields', color: 'var(--blue)' }
];

export type NodeData = typeof NODE_TYPES[0] & { edgeCount?: number };

type Props = {
  onHoverNode?: (node: NodeData | null) => void;
};

export function InteractiveToyGraph({ onHoverNode }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [nodesPos, setNodesPos] = useState<Record<string, { x: number, y: number }>>(() => {
    const initial: Record<string, { x: number, y: number }> = {};
    for (const n of NODE_TYPES) {
      initial[n.id] = { x: n.initialX, y: n.initialY }; // Percentages 0-100
    }
    return initial;
  });

  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 800, height: 500 });

  // Update bounds on resize to keep SVG lines in sync with percentage positions
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (onHoverNode) {
      if (hoveredNode) {
        const node = NODE_TYPES.find(n => n.id === hoveredNode)!;
        const edgeCount = EDGES.filter(e => e.from === node.id || e.to === node.id).length;
        onHoverNode({ ...node, edgeCount });
      } else {
        onHoverNode(null);
      }
    }
  }, [hoveredNode, onHoverNode]);

  const handlePointerDown = (e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    setDraggingNode(id);
    setHoveredNode(id);
  };

  useEffect(() => {
    if (!draggingNode) return;

    const handlePointerMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      let newXPct = ((e.clientX - rect.left) / rect.width) * 100;
      let newYPct = ((e.clientY - rect.top) / rect.height) * 100;

      // Keep within bounds
      newXPct = Math.max(5, Math.min(newXPct, 95));
      newYPct = Math.max(5, Math.min(newYPct, 95));

      setNodesPos(prev => ({
        ...prev,
        [draggingNode]: { x: newXPct, y: newYPct }
      }));
    };

    const handlePointerUp = () => {
      setDraggingNode(null);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [draggingNode]);

  return (
    <div className="toy-graph-container" ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: '500px' }}>
      <svg className="toy-graph-edges" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {EDGES.map((edge, i) => {
          const sPct = nodesPos[edge.from];
          const tPct = nodesPos[edge.to];

          // Convert percentages to actual pixels for SVG path
          const sx = (sPct.x / 100) * bounds.width;
          const sy = (sPct.y / 100) * bounds.height;
          const tx = (tPct.x / 100) * bounds.width;
          const ty = (tPct.y / 100) * bounds.height;

          const path = `M ${sx + 60} ${sy} C ${sx + 120} ${sy}, ${tx - 120} ${ty}, ${tx - 60} ${ty}`;
          const isFaded = hoveredNode && hoveredNode !== edge.from && hoveredNode !== edge.to;

          return (
            <g key={i} className={`toy-edge ${isFaded ? 'faded' : ''}`}>
              <path
                d={path}
                fill="none"
                stroke={edge.color || 'var(--border-2)'}
                strokeWidth="2"
                strokeDasharray={edge.label === 'proposes' ? '6 6' : 'none'}
              />
              <text
                x={(sx + tx) / 2}
                y={(sy + ty) / 2 - 10}
                fill="var(--muted)"
                fontSize="12"
                fontWeight="bold"
                textAnchor="middle"
              >
                {edge.label}
              </text>
            </g>
          );
        })}
      </svg>

      {NODE_TYPES.map(node => {
        const isHovered = hoveredNode === node.id;
        const isFaded = hoveredNode && hoveredNode !== node.id;
        const pos = nodesPos[node.id];

        return (
          <div
            key={node.id}
            className={`toy-node type-${node.type} ${isHovered ? 'active' : ''} ${isFaded ? 'faded' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, position: 'absolute' }}
            onMouseEnter={() => !draggingNode && setHoveredNode(node.id)}
            onMouseLeave={() => !draggingNode && setHoveredNode(null)}
            onMouseDown={(e) => handlePointerDown(e, node.id)}
          >
            <div className="toy-node-label">{node.label}</div>
            <div className="toy-node-text">{node.text}</div>
          </div>
        );
      })}
    </div>
  );
}
