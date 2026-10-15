import type {
  ConversationCandidate,
  Edge,
  Institution,
  ReferenceStub,
  Researcher,
  Snapshot,
  Topic,
  Work,
} from '../types/contract';

export interface Indexes {
  works: Map<string, Work>;
  researchers: Map<string, Researcher>;
  topics: Map<string, Topic>;
  institutions: Map<string, Institution>;
  references: Map<string, ReferenceStub>;
  edges: Map<string, Edge>;
  candidates: Map<string, ConversationCandidate>;
  edgesByNode: Map<string, Edge[]>;
  candidatesByResearcher: Map<string, ConversationCandidate[]>;
}

function byId<T extends { id: string }>(xs: T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]));
}

export function buildIndexes(s: Snapshot): Indexes {
  const edgesByNode = new Map<string, Edge[]>();
  const push = (k: string, e: Edge) => {
    const l = edgesByNode.get(k);
    if (l) l.push(e);
    else edgesByNode.set(k, [e]);
  };
  for (const e of s.edges) {
    push(e.source, e);
    push(e.target, e);
  }
  const candidatesByResearcher = new Map<string, ConversationCandidate[]>();
  for (const c of s.candidates) {
    for (const r of [c.a, c.b]) {
      const l = candidatesByResearcher.get(r) ?? [];
      l.push(c);
      candidatesByResearcher.set(r, l);
    }
  }
  return {
    works: byId(s.works),
    researchers: byId(s.researchers),
    topics: byId(s.topics),
    institutions: byId(s.institutions),
    references: byId(s.references),
    edges: byId(s.edges),
    candidates: byId(s.candidates),
    edgesByNode,
    candidatesByResearcher,
  };
}

export type SearchKind = 'person' | 'work' | 'topic';
export interface SearchHit {
  id: string;
  kind: SearchKind;
  label: string;
  rank: number;
}

/** Prefix matches (on any word) rank above substring matches. */
export function search(s: Snapshot, q: string, limit = 20): SearchHit[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const hits: SearchHit[] = [];
  const consider = (id: string, kind: SearchKind, label: string) => {
    const l = label.toLowerCase();
    let rank = -1;
    if (l.startsWith(query)) rank = 0;
    else if (l.split(/[\s\-–:,.()]+/).some((w) => w.startsWith(query))) rank = 1;
    else if (l.includes(query) || id.toLowerCase() === query) rank = 2;
    if (rank >= 0) hits.push({ id, kind, label, rank });
  };
  for (const r of s.researchers) consider(r.id, 'person', r.name);
  for (const w of s.works) consider(w.id, 'work', w.title);
  for (const t of s.topics) consider(t.id, 'topic', t.name);
  hits.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return hits.slice(0, limit);
}

/** Deterministic fallback position in [-1, 1] when layout lacks an id. */
export function fallbackPos(id: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  const r = 0.3 + (((h >>> 12) % 1000) / 1000) * 0.65;
  return [Math.cos(a) * r, Math.sin(a) * r];
}
