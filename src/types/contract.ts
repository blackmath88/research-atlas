// Research Atlas shared data contract (schemaVersion 1).
// Produced by pipeline/atlas/export.py, consumed by the browser.
// Coordinator-owned: change only together with the pipeline exporter.

export const SCHEMA_VERSION = 1;

/** source = upstream assertion; derived = computed by the pipeline; hypothesis = conversation lead. */
export type EvidenceCategory = 'source' | 'derived' | 'hypothesis';

export type CollectionStatus =
  | 'complete'
  | 'cap_reached'
  | 'auth_blocked'
  | 'rate_limited'
  | 'transport_failure'
  | 'partial';

export interface CollectionIndexEntry {
  id: string;
  label: string;
  /** published = snapshot file available; not_collected = no real snapshot yet. */
  availability: 'published' | 'not_collected';
  snapshotPath: string | null;
  synthetic: boolean;
  note: string;
}

export interface CollectionIndex {
  schemaVersion: number;
  collections: CollectionIndexEntry[];
}

export interface Provenance {
  provider: string; // "OpenAlex" or "SYNTHETIC FIXTURE"
  sourceId: string; // full upstream identifier
  sourceUrl: string | null; // human-followable link
  retrievedAt: string; // ISO timestamp of retrieval
  contentHash: string; // sha256 of the sanitized raw record
}

export interface TopicAssignment {
  topicId: string;
  score: number | null; // upstream classifier score, not verified truth
  rank: number; // order supplied upstream (0 = primary)
}

export interface Authorship {
  /** null = upstream supplied no author ID; never filled from name matching. */
  researcherId: string | null;
  rawName: string;
  position: string; // first | middle | last | unknown
  /** Publication-context affiliations, not present employment. */
  institutionIds: string[];
}

export interface Work {
  id: string; // short stable id, e.g. W123
  doi: string | null;
  title: string;
  year: number | null;
  date: string | null;
  type: string | null;
  abstract: string | null;
  abstractStatus: 'present' | 'missing';
  topics: TopicAssignment[];
  authorships: Authorship[];
  /** Upstream marked the author list as truncated, or the large-list threshold applied. */
  authorsTruncated: boolean;
  largeAuthorList: boolean;
  referenceIds: string[];
  /** present = list supplied and non-empty; empty = supplied empty; missing = field absent. */
  referencesStatus: 'present' | 'empty' | 'missing';
  provenance: Provenance;
}

export interface Researcher {
  id: string;
  name: string; // label only, never a merge key
  orcid: string | null;
  workIds: string[];
  sourceUrl: string | null;
}

export interface Institution {
  id: string;
  name: string;
  ror: string | null;
  countryCode: string | null;
  sourceUrl: string | null;
}

export interface Topic {
  id: string;
  name: string;
  subfield: string | null;
  field: string | null;
  domain: string | null;
  sourceUrl: string | null;
}

/** A referenced work. in_corpus = full Work exists; external_unresolved = only the identifier is known. */
export interface ReferenceStub {
  id: string;
  status: 'in_corpus' | 'external_unresolved';
  sourceUrl: string | null;
  citedBy: string[]; // in-corpus work ids
}

export type EdgeType =
  | 'AUTHORED'
  | 'CITES'
  | 'HAS_TOPIC'
  | 'COAUTHORED'
  | 'SHARES_REFERENCES'
  | 'CONVERSATION_CANDIDATE';

export interface EdgeEvidence {
  /** Works whose source assertions support this edge. A filter that excludes all of them hides the edge. */
  workIds: string[];
  referenceIds: string[];
  method: string | null; // e.g. "jaccard-references@1"; null for source assertions
  params: Record<string, number | string> | null;
  /** Raw overlap count where applicable. */
  overlap: number | null;
  score: number | null;
}

export interface Edge {
  id: string;
  type: EdgeType;
  category: EvidenceCategory;
  source: string;
  target: string;
  evidence: EdgeEvidence;
}

export interface SupportingPair {
  workA: string; // authored by researcher a
  workB: string; // authored by researcher b
  sharedReferenceIds: string[];
  sharedTopicIds: string[];
  jaccard: number;
}

export interface ConversationCandidate {
  id: string;
  a: string;
  b: string;
  strength: 'shared_references' | 'topic_only';
  sharedReferenceCount: number;
  score: number; // ranking aid only; not a probability of collaboration
  supportingPairs: SupportingPair[];
  limitations: string[];
}

export interface MethodNote {
  id: string;
  label: string;
  description: string;
  params: Record<string, number | string>;
}

export interface Missingness {
  worksWithoutAbstract: number;
  worksWithoutTopics: number;
  worksWithoutReferences: number;
  worksWithEmptyReferences: number;
  authorshipsWithoutResearcherId: number;
  worksWithTruncatedAuthors: number;
  worksWithLargeAuthorLists: number;
  externalUnresolvedReferences: number;
}

export interface SnapshotMeta {
  id: string; // content-derived
  schemaVersion: number;
  collectionId: string;
  label: string;
  synthetic: boolean;
  provider: string;
  attribution: string;
  query: Record<string, unknown>;
  retrievedAt: string | null;
  status: CollectionStatus;
  providerTotal: number | null;
  maxWorks: number;
  counts: Record<string, number>;
  missingness: Missingness;
  methods: MethodNote[];
  warnings: string[];
}

export interface Snapshot {
  meta: SnapshotMeta;
  works: Work[];
  researchers: Researcher[];
  institutions: Institution[];
  topics: Topic[];
  references: ReferenceStub[];
  edges: Edge[];
  candidates: ConversationCandidate[];
  /** Deterministic layout for researchers and works: id -> [x, y] in [-1, 1]. */
  layout: Record<string, [number, number]>;
}
