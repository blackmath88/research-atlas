import { Fragment, type ReactNode } from 'react';
import type { ConversationCandidate, Edge, EvidenceCategory, Missingness, Snapshot, Work } from '../types/contract';
import type { Indexes } from '../lib/indexes';
import type { Visibility } from '../lib/filter';

type Select = (id: string) => void;

export function Ext({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Link({ id, onSelect, children }: { id: string; onSelect: Select; children: ReactNode }) {
  return (
    <button type="button" className="linklike" onClick={() => onSelect(id)}>
      {children}
    </button>
  );
}

const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  source: 'Source assertion',
  derived: 'Computed relationship',
  hypothesis: 'Conversation hypothesis',
};

export function Badge({ category }: { category: EvidenceCategory }) {
  return <span className={`badge badge-${category}`}>{CATEGORY_LABEL[category]}</span>;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return 'unknown';
  return s.slice(0, 10);
}

export function PersonPanel({
  id,
  idx,
  vis,
  onSelect,
}: {
  id: string;
  idx: Indexes;
  vis: Visibility;
  onSelect: Select;
}) {
  const r = idx.researchers.get(id)!;
  const works = r.workIds.map((w) => idx.works.get(w)).filter((w): w is Work => !!w);
  const coauthors = (idx.edgesByNode.get(id) ?? [])
    .filter((e) => e.type === 'COAUTHORED')
    .map((e) => ({ edge: e, other: e.source === id ? e.target : e.source }));
  const affiliations = new Map<string, Set<string>>();
  for (const w of works) {
    for (const a of w.authorships) {
      if (a.researcherId !== id) continue;
      for (const inst of a.institutionIds) {
        const s = affiliations.get(inst) ?? new Set();
        s.add(w.id);
        affiliations.set(inst, s);
      }
    }
  }
  const cands = idx.candidatesByResearcher.get(id) ?? [];
  return (
    <div>
      <p className="kind">Researcher</p>
      <h2>{r.name}</h2>
      <p className="links">
        {r.orcid && (
          <Ext href={r.orcid.startsWith('http') ? r.orcid : `https://orcid.org/${r.orcid}`}>ORCID {r.orcid.replace(/^https?:\/\/orcid.org\//, '')}</Ext>
        )}
        {r.sourceUrl && <Ext href={r.sourceUrl}>Source record</Ext>}
      </p>
      <h3>Works in this snapshot ({works.length})</h3>
      <ul className="plain">
        {works.map((w) => (
          <li key={w.id} className={vis.works.has(w.id) ? '' : 'filtered'}>
            <Link id={w.id} onSelect={onSelect}>{w.title}</Link> <span className="muted">{w.year ?? 'year unknown'}</span>
            {!vis.works.has(w.id) && <span className="muted"> (hidden by filters)</span>}
          </li>
        ))}
      </ul>
      <h3>Coauthors in this snapshot</h3>
      {coauthors.length === 0 ? (
        <p className="muted">No shared publication found in this snapshot.</p>
      ) : (
        <ul className="plain">
          {coauthors.map(({ edge, other }) => (
            <li key={edge.id}>
              <Link id={other} onSelect={onSelect}>{idx.researchers.get(other)?.name ?? other}</Link>{' '}
              <span className="muted">
                {edge.evidence.workIds.length} shared work{edge.evidence.workIds.length === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3>Affiliation listed on publication (not current employment)</h3>
      {affiliations.size === 0 ? (
        <p className="muted">No affiliations listed on this person's publications in this snapshot.</p>
      ) : (
        <ul className="plain">
          {[...affiliations].map(([inst, ws]) => {
            const i = idx.institutions.get(inst);
            return (
              <li key={inst}>
                <Ext href={i?.sourceUrl}>{i?.name ?? inst}</Ext>{' '}
                <span className="muted">on {ws.size} publication{ws.size === 1 ? '' : 's'}</span>
              </li>
            );
          })}
        </ul>
      )}
      <h3>Conversation candidates</h3>
      {cands.length === 0 ? (
        <p className="muted">None in this snapshot.</p>
      ) : (
        <ul className="plain" data-testid="person-candidates">
          {cands.map((c) => {
            const other = c.a === id ? c.b : c.a;
            const visible = vis.candidates.has(c.id);
            if (!visible) return null;
            return (
              <li key={c.id} data-candidate-id={c.id}>
                <Badge category="hypothesis" /> {idx.researchers.get(other)?.name ?? other}{' '}
                <span className="muted">
                  {c.sharedReferenceCount} shared reference{c.sharedReferenceCount === 1 ? '' : 's'}
                </span>{' '}
                <button type="button" onClick={() => onSelect(c.id)}>Why this connection?</button>
              </li>
            );
          })}
        </ul>
      )}
      {cands.length > 0 && cands.every((c) => !vis.candidates.has(c.id)) && (
        <p className="muted">All candidates are hidden by the current filters.</p>
      )}
    </div>
  );
}

export function WorkPanel({ id, idx, onSelect }: { id: string; idx: Indexes; onSelect: Select }) {
  const w = idx.works.get(id)!;
  const inCorpus: string[] = [];
  const external: { id: string; url: string | null }[] = [];
  for (const r of w.referenceIds) {
    const stub = idx.references.get(r);
    if (idx.works.has(r) || stub?.status === 'in_corpus') inCorpus.push(r);
    else external.push({ id: r, url: stub?.sourceUrl ?? null });
  }
  const sharing = (idx.edgesByNode.get(id) ?? []).filter((e) => e.type === 'SHARES_REFERENCES');
  const citedBy = (idx.edgesByNode.get(id) ?? []).filter((e) => e.type === 'CITES' && e.target === id);
  return (
    <div>
      <p className="kind">Work</p>
      <h2>{w.title}</h2>
      <dl className="facts">
        <dt>Year</dt><dd>{w.year ?? 'unknown'}</dd>
        <dt>Type</dt><dd>{w.type ?? 'unknown'}</dd>
        <dt>DOI</dt>
        <dd>{w.doi ? <Ext href={w.doi.startsWith('http') ? w.doi : `https://doi.org/${w.doi}`}>{w.doi}</Ext> : 'not supplied'}</dd>
        <dt>Source</dt>
        <dd>
          <Ext href={w.provenance.sourceUrl}>{w.provenance.provider} record</Ext>
        </dd>
        <dt>Retrieved</dt><dd>{fmtDate(w.provenance.retrievedAt)}</dd>
      </dl>
      <h3>Abstract</h3>
      {w.abstract ? <p className="abstract">{w.abstract}</p> : <p className="muted">No abstract supplied by source.</p>}
      <h3>Topics <span className="muted small">(upstream classification)</span></h3>
      {w.topics.length === 0 ? (
        <p className="muted">No topics supplied by source.</p>
      ) : (
        <ul className="plain">
          {w.topics.map((t) => (
            <li key={t.topicId}>
              {idx.topics.get(t.topicId)?.name ?? t.topicId}{' '}
              <span className="muted">upstream classifier score: {t.score == null ? 'not supplied' : t.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
      <h3>Authors ({w.authorships.length})</h3>
      {(w.authorsTruncated || w.largeAuthorList) && (
        <p className="notice">
          {w.authorsTruncated ? 'The author list supplied by the source is truncated. ' : ''}
          {w.largeAuthorList ? 'Large author list: coauthorship links from this work may be limited.' : ''}
        </p>
      )}
      <ol className="authors">
        {w.authorships.map((a, i) => (
          <li key={i}>
            {a.researcherId && idx.researchers.has(a.researcherId) ? (
              <Link id={a.researcherId} onSelect={onSelect}>{a.rawName}</Link>
            ) : (
              <span>{a.rawName}</span>
            )}
            {a.researcherId == null && <span className="muted"> — author ID not supplied</span>}
          </li>
        ))}
      </ol>
      <h3>References</h3>
      {w.referencesStatus === 'missing' && <p className="muted">Reference list not supplied by source.</p>}
      {w.referencesStatus === 'empty' && <p className="muted">Source supplied an empty reference list.</p>}
      {inCorpus.length > 0 && (
        <>
          <p>In this snapshot ({inCorpus.length}):</p>
          <ul className="plain">
            {inCorpus.map((r) => (
              <li key={r}>
                {idx.works.has(r) ? <Link id={r} onSelect={onSelect}>{idx.works.get(r)!.title}</Link> : r}
              </li>
            ))}
          </ul>
        </>
      )}
      {external.length > 0 && (
        <details>
          <summary>{external.length} external reference{external.length === 1 ? '' : 's'} (not resolved in this snapshot)</summary>
          <ul className="plain">
            {external.map((r) => (
              <li key={r.id}><Ext href={r.url}>{r.id}</Ext></li>
            ))}
          </ul>
        </details>
      )}
      {citedBy.length > 0 && (
        <>
          <h3>Cited by (in this snapshot)</h3>
          <ul className="plain">
            {citedBy.map((e) => (
              <li key={e.id}><Link id={e.source} onSelect={onSelect}>{idx.works.get(e.source)?.title ?? e.source}</Link></li>
            ))}
          </ul>
        </>
      )}
      <h3>Works sharing references</h3>
      {sharing.length === 0 ? (
        <p className="muted">None in this snapshot.</p>
      ) : (
        <ul className="plain">
          {sharing.map((e) => {
            const other = e.source === id ? e.target : e.source;
            return (
              <li key={e.id}>
                <Badge category={e.category} />{' '}
                <Link id={other} onSelect={onSelect}>{idx.works.get(other)?.title ?? other}</Link>{' '}
                <span className="muted">{e.evidence.overlap ?? e.evidence.referenceIds.length} shared</span>{' '}
                <button type="button" onClick={() => onSelect(e.id)}>Why this connection?</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function refLink(idx: Indexes, r: string, onSelect: Select) {
  if (idx.works.has(r)) return <Link id={r} onSelect={onSelect}>{idx.works.get(r)!.title}</Link>;
  return <Ext href={idx.references.get(r)?.sourceUrl}>{r}</Ext>;
}

function MethodBlock({ method, params, overlap, score }: { method: string | null; params: Record<string, string | number> | null; overlap: number | null; score: number | null }) {
  return (
    <dl className="facts">
      <dt>Method</dt><dd>{method ?? 'none (stated by source record)'}</dd>
      {params && (
        <>
          <dt>Parameters</dt>
          <dd>{Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ')}</dd>
        </>
      )}
      {overlap != null && (<><dt>Overlap</dt><dd>{overlap}</dd></>)}
      {score != null && (<><dt>Score</dt><dd>{score.toFixed(3)} <span className="muted">(ranking aid, not a probability)</span></dd></>)}
    </dl>
  );
}

function SharedPath({
  idx, ra, wa, wb, rb, refs, onSelect,
}: { idx: Indexes; ra?: string; wa: string; wb: string; rb?: string; refs: string[]; onSelect: Select }) {
  const name = (id?: string) => (id ? idx.researchers.get(id)?.name ?? id : '');
  const title = (id: string) => idx.works.get(id)?.title ?? id;
  return (
    <div className="path" data-testid="evidence-path">
      <ol className="steps">
        {ra && <li><Link id={ra} onSelect={onSelect}>{name(ra)}</Link> <span className="muted">→ authored</span> <Badge category="source" /></li>}
        <li><Link id={wa} onSelect={onSelect}>{title(wa)}</Link> <span className="muted">→ cites</span> <Badge category="source" /></li>
        <li>
          <strong>{refs.length} shared reference{refs.length === 1 ? '' : 's'}</strong> <Badge category="derived" />
          <ul className="plain refs" data-testid="shared-references">
            {refs.map((r) => <li key={r}>{refLink(idx, r, onSelect)}</li>)}
          </ul>
        </li>
        <li><span className="muted">← cited by</span> <Link id={wb} onSelect={onSelect}>{title(wb)}</Link> <Badge category="source" /></li>
        {rb && <li><span className="muted">← authored by</span> <Link id={rb} onSelect={onSelect}>{name(rb)}</Link> <Badge category="source" /></li>}
      </ol>
      <p className="small muted">
        The authorship and citation steps are source assertions from the provider record. The shared-reference link is computed by Atlas.
      </p>
    </div>
  );
}

export function CandidatePanel({ c, idx, onSelect }: { c: ConversationCandidate; idx: Indexes; onSelect: Select }) {
  const name = (id: string) => idx.researchers.get(id)?.name ?? id;
  return (
    <div data-testid="connection-panel">
      <p className="kind">Why this connection?</p>
      <h2>{name(c.a)} ↔ {name(c.b)}</h2>
      <p><Badge category="hypothesis" /> A possible conversation lead, not a fact.</p>
      <p className="notice">No shared publication found in this snapshot.</p>
      <MethodBlock method={`candidate (${c.strength.replace('_', ' ')})`} params={null} overlap={c.sharedReferenceCount} score={c.score} />
      <h3>Evidence</h3>
      {c.supportingPairs.map((p, i) => (
        <div key={i}>
          <SharedPath idx={idx} ra={c.a} wa={p.workA} wb={p.workB} rb={c.b} refs={p.sharedReferenceIds} onSelect={onSelect} />
          {p.sharedTopicIds.length > 0 && (
            <p className="small">Shared upstream topics: {p.sharedTopicIds.map((t) => idx.topics.get(t)?.name ?? t).join(', ')}</p>
          )}
          <p className="small muted">Jaccard overlap of the two reference lists: {p.jaccard.toFixed(3)}</p>
        </div>
      ))}
      <h3>Limitations</h3>
      <ul>
        {c.limitations.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}

export function EdgePanel({ e, idx, onSelect }: { e: Edge; idx: Indexes; onSelect: Select }) {
  const label = (id: string) => idx.researchers.get(id)?.name ?? idx.works.get(id)?.title ?? idx.topics.get(id)?.name ?? id;
  const typeLabel = e.type.replace(/_/g, ' ').toLowerCase();
  return (
    <div data-testid="connection-panel">
      <p className="kind">Why this connection?</p>
      <h2>
        <Link id={e.source} onSelect={onSelect}>{label(e.source)}</Link> — {typeLabel} —{' '}
        {idx.works.has(e.target) || idx.researchers.has(e.target) ? <Link id={e.target} onSelect={onSelect}>{label(e.target)}</Link> : label(e.target)}
      </h2>
      <p><Badge category={e.category} /></p>
      <MethodBlock method={e.evidence.method} params={e.evidence.params} overlap={e.evidence.overlap} score={e.evidence.score} />
      {e.type === 'SHARES_REFERENCES' && (
        <SharedPath idx={idx} wa={e.source} wb={e.target} refs={e.evidence.referenceIds} onSelect={onSelect} />
      )}
      <h3>Supporting works</h3>
      <ul className="plain">
        {e.evidence.workIds.map((w) => (
          <li key={w}>
            <Link id={w} onSelect={onSelect}>{idx.works.get(w)?.title ?? w}</Link>{' '}
            <Ext href={idx.works.get(w)?.provenance.sourceUrl}>source</Ext>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MISSING_LABELS: Record<keyof Missingness, string> = {
  worksWithoutAbstract: 'Works without an abstract',
  worksWithoutTopics: 'Works without topics',
  worksWithoutReferences: 'Works with no reference list supplied',
  worksWithEmptyReferences: 'Works with an empty reference list',
  authorshipsWithoutResearcherId: 'Authorships without an author ID',
  worksWithTruncatedAuthors: 'Works with a truncated author list',
  worksWithLargeAuthorLists: 'Works with a large author list',
  externalUnresolvedReferences: 'References outside this snapshot (unresolved)',
};

export function CoveragePanel({ s }: { s: Snapshot }) {
  const m = s.meta;
  return (
    <div data-testid="coverage-panel">
      <p className="kind">Coverage</p>
      <h2>{m.label}</h2>
      <dl className="facts">
        <dt>Provider</dt><dd>{m.provider}</dd>
        <dt>Attribution</dt><dd>{m.attribution}</dd>
        <dt>Snapshot</dt><dd><code>{m.id}</code></dd>
        <dt>Retrieved</dt><dd>{fmtDate(m.retrievedAt)}</dd>
        <dt>Status</dt><dd>{m.status.replace(/_/g, ' ')}</dd>
        <dt>Provider total</dt><dd>{m.providerTotal ?? 'unknown'}</dd>
        <dt>Max works</dt><dd>{m.maxWorks}</dd>
      </dl>
      <h3>Query / bounds</h3>
      <pre className="query">{JSON.stringify(m.query, null, 2)}</pre>
      <h3>Counts</h3>
      <dl className="facts">
        {Object.entries(m.counts).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>))}
      </dl>
      <h3>Missing or limited data</h3>
      <dl className="facts">
        {(Object.keys(MISSING_LABELS) as (keyof Missingness)[]).map((k) => (
          <Fragment key={k}><dt>{MISSING_LABELS[k]}</dt><dd>{m.missingness[k]}</dd></Fragment>
        ))}
      </dl>
      <h3>Methods</h3>
      <ul>
        {m.methods.map((x) => (
          <li key={x.id}>
            <strong>{x.label}</strong> <code>{x.id}</code>: {x.description}
            {Object.keys(x.params).length > 0 && (
              <span className="muted"> ({Object.entries(x.params).map(([k, v]) => `${k}=${v}`).join(', ')})</span>
            )}
          </li>
        ))}
      </ul>
      <h3>Warnings</h3>
      {m.warnings.length === 0 ? <p className="muted">None.</p> : <ul>{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>
  );
}
