import type { ConversationCandidate, Edge, Snapshot, Work } from '../types/contract';

export interface FilterState {
  /** Inclusive year range; null = no year restriction. */
  yearRange: [number, number] | null;
  /** Selected topic ids; empty = no topic restriction. */
  topics: string[];
}

export interface Visibility {
  works: Set<string>;
  edges: Set<string>;
  candidates: Set<string>;
}

export function workPasses(work: Work, f: FilterState): boolean {
  if (f.yearRange) {
    if (work.year == null) return false;
    if (work.year < f.yearRange[0] || work.year > f.yearRange[1]) return false;
  }
  if (f.topics.length > 0) {
    const sel = new Set(f.topics);
    if (!work.topics.some((t) => sel.has(t.topicId))) return false;
  }
  return true;
}

export function candidatePasses(c: ConversationCandidate, passing: Set<string>): boolean {
  return c.supportingPairs.some((p) => passing.has(p.workA) && passing.has(p.workB));
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function edgePasses(
  edge: Edge,
  passing: Set<string>,
  workIds: Set<string>,
  candidatesByPair: Map<string, ConversationCandidate>,
): boolean {
  if (edge.type === 'CONVERSATION_CANDIDATE') {
    const c = candidatesByPair.get(pairKey(edge.source, edge.target));
    if (c) return candidatePasses(c, passing);
    return edge.evidence.workIds.some((w) => passing.has(w));
  }
  const ev = edge.evidence.workIds;
  if (ev.length > 0 && !ev.some((w) => passing.has(w))) return false;
  if (edge.type === 'AUTHORED' || edge.type === 'HAS_TOPIC' || edge.type === 'CITES') {
    for (const end of [edge.source, edge.target]) {
      if (workIds.has(end) && !passing.has(end)) return false;
    }
    return true;
  }
  return ev.length > 0;
}

/** Pure: computes which works, edges and candidates survive the filters. */
export function computeVisibility(snapshot: Snapshot, f: FilterState): Visibility {
  const works = new Set<string>();
  const allWorks = new Set<string>();
  for (const w of snapshot.works) {
    allWorks.add(w.id);
    if (workPasses(w, f)) works.add(w.id);
  }
  const byPair = new Map<string, ConversationCandidate>();
  const candidates = new Set<string>();
  for (const c of snapshot.candidates) {
    byPair.set(pairKey(c.a, c.b), c);
    if (candidatePasses(c, works)) candidates.add(c.id);
  }
  const edges = new Set<string>();
  for (const e of snapshot.edges) {
    if (edgePasses(e, works, allWorks, byPair)) edges.add(e.id);
  }
  return { works, edges, candidates };
}

export function yearExtent(snapshot: Snapshot): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const w of snapshot.works) {
    if (w.year == null) continue;
    lo = Math.min(lo, w.year);
    hi = Math.max(hi, w.year);
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}
