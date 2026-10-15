import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Edge, Snapshot } from '../types/contract';
import type { Indexes } from '../lib/indexes';
import { fallbackPos } from '../lib/indexes';
import type { Visibility } from '../lib/filter';

interface Props {
  snapshot: Snapshot;
  idx: Indexes;
  vis: Visibility;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Edges drawn between researcher/work nodes only. */
const DRAWABLE = new Set(['AUTHORED', 'COAUTHORED', 'CITES', 'SHARES_REFERENCES', 'CONVERSATION_CANDIDATE']);

export function Constellation({ snapshot, idx, vis, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 12])
      .on('zoom', (ev: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        gRef.current?.setAttribute('transform', ev.transform.toString());
      });
    d3.select(svg).call(z);
    zoomRef.current = z;
    return () => {
      d3.select(svg).on('.zoom', null);
    };
  }, []);

  const nodeIds = useMemo(() => {
    const ids: { id: string; kind: 'person' | 'work' }[] = [];
    for (const r of snapshot.researchers) ids.push({ id: r.id, kind: 'person' });
    for (const w of snapshot.works) if (vis.works.has(w.id)) ids.push({ id: w.id, kind: 'work' });
    return ids;
  }, [snapshot, vis]);

  const pos = useMemo(() => {
    const pad = 40;
    const sx = Math.max(10, (size.w - pad * 2) / 2);
    const sy = Math.max(10, (size.h - pad * 2) / 2);
    const s = Math.min(sx, sy);
    const m = new Map<string, [number, number]>();
    for (const n of nodeIds) {
      const p = snapshot.layout[n.id] ?? fallbackPos(n.id);
      m.set(n.id, [size.w / 2 + p[0] * s, size.h / 2 + p[1] * s]);
    }
    return m;
  }, [nodeIds, snapshot.layout, size]);

  // Researchers with no visible authored work are hidden.
  const visibleNodes = useMemo(() => {
    const activePeople = new Set<string>();
    for (const e of snapshot.edges) {
      if (e.type === 'AUTHORED' && vis.edges.has(e.id)) activePeople.add(e.source);
    }
    return nodeIds.filter((n) => n.kind === 'work' || activePeople.has(n.id) || n.id === selected);
  }, [nodeIds, snapshot.edges, vis, selected]);
  const visibleSet = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const { edges, neighbours } = useMemo(() => {
    const neighbours = new Set<string>();
    let focus: string[] = [];
    if (selected) {
      const e = idx.edges.get(selected);
      const c = idx.candidates.get(selected);
      if (e) focus = [e.source, e.target];
      else if (c) focus = [c.a, c.b, ...c.supportingPairs.flatMap((p) => [p.workA, p.workB])];
      else focus = [selected];
    }
    focus.forEach((f) => neighbours.add(f));
    const drawn: Edge[] = [];
    for (const e of snapshot.edges) {
      if (!DRAWABLE.has(e.type) || !vis.edges.has(e.id)) continue;
      if (!visibleSet.has(e.source) || !visibleSet.has(e.target)) continue;
      const touches = focus.includes(e.source) || focus.includes(e.target) || e.id === selected;
      if (e.type === 'AUTHORED' || touches) drawn.push(e);
      if (touches) {
        neighbours.add(e.source);
        neighbours.add(e.target);
      }
    }
    return { edges: drawn, neighbours };
  }, [selected, idx, snapshot.edges, vis, visibleSet]);

  const zoomBy = (k: number) => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const sel = d3.select(svg);
    if (reducedMotion()) zoomRef.current.scaleBy(sel, k);
    else zoomRef.current.scaleBy(sel.transition().duration(200), k);
  };
  const reset = () => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const sel = d3.select(svg);
    if (reducedMotion()) zoomRef.current.transform(sel, d3.zoomIdentity);
    else zoomRef.current.transform(sel.transition().duration(250), d3.zoomIdentity);
  };

  const hasFocus = selected != null && neighbours.size > 0;

  return (
    <div className="constellation" ref={wrapRef}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        role="img"
        aria-label="Constellation of researchers and works. Use the List view for a keyboard-accessible alternative."
        onClick={(ev) => {
          if (ev.target === svgRef.current) onSelect(null);
        }}
      >
        <g ref={gRef}>
          {edges.map((e) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            const highlighted = hasFocus && (neighbours.has(e.source) && neighbours.has(e.target));
            return (
              <line
                key={e.id}
                data-edge-id={e.id}
                data-edge-type={e.type}
                className={`edge edge-${e.category}${highlighted ? ' hl' : ''}${hasFocus && !highlighted ? ' dim' : ''}`}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(e.type === 'CONVERSATION_CANDIDATE' ? candidateIdFor(idx, e) ?? e.id : e.id);
                }}
              >
                <title>{e.type.replace(/_/g, ' ').toLowerCase()}</title>
              </line>
            );
          })}
          {visibleNodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const label = n.kind === 'person' ? idx.researchers.get(n.id)?.name : idx.works.get(n.id)?.title;
            const isSel = n.id === selected;
            const dim = hasFocus && !neighbours.has(n.id);
            return (
              <g
                key={n.id}
                data-node-id={n.id}
                className={`node node-${n.kind}${isSel ? ' sel' : ''}${dim ? ' dim' : ''}`}
                transform={`translate(${p[0]},${p[1]})`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(n.id);
                }}
              >
                {n.kind === 'person' ? <circle r={isSel ? 8 : 6} /> : <rect x={-3.5} y={-3.5} width={7} height={7} />}
                <title>{label}</title>
                {(isSel || (hasFocus && neighbours.has(n.id) && n.kind === 'person')) && (
                  <text x={10} y={4}>
                    {truncate(label ?? n.id, 40)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="zoom-controls" aria-label="Zoom controls">
        <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" onClick={reset}>Fit</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}

function candidateIdFor(idx: Indexes, e: Edge): string | null {
  for (const c of idx.candidates.values()) {
    if ((c.a === e.source && c.b === e.target) || (c.a === e.target && c.b === e.source)) return c.id;
  }
  return null;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <div>
        <svg width="34" height="10" aria-hidden="true"><line className="edge edge-source" x1="2" y1="5" x2="32" y2="5" /></svg>
        <span>Source assertion — stated by the source record</span>
      </div>
      <div>
        <svg width="34" height="10" aria-hidden="true"><line className="edge edge-derived" x1="2" y1="5" x2="32" y2="5" /></svg>
        <span>Computed relationship — derived by Atlas from source records</span>
      </div>
      <div>
        <svg width="34" height="10" aria-hidden="true"><line className="edge edge-hypothesis" x1="2" y1="5" x2="32" y2="5" /></svg>
        <span>Conversation hypothesis — a possible lead, not a fact</span>
      </div>
      <div className="legend-nodes">
        <svg width="12" height="12" aria-hidden="true"><circle className="legend-person" cx="6" cy="6" r="5" /></svg>
        <span>Researcher</span>
        <svg width="12" height="12" aria-hidden="true"><rect className="legend-work" x="2" y="2" width="8" height="8" /></svg>
        <span>Work</span>
      </div>
    </div>
  );
}
