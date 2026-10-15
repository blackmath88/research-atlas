import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionIndex, Snapshot } from './types/contract';
import { buildIndexes, search, type SearchHit } from './lib/indexes';
import { computeVisibility, yearExtent } from './lib/filter';
import { readUrl, writeUrl, type View } from './lib/url';
import { Constellation, Legend } from './components/Constellation';
import { CandidatePanel, CoveragePanel, EdgePanel, PersonPanel, WorkPanel } from './components/Panels';

const initial = readUrl();

export function App() {
  const dataPath = initial.data ?? './data/collections.json';
  const [index, setIndex] = useState<CollectionIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [collection, setCollection] = useState<string | null>(initial.collection);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(initial.sel);
  const [view, setView] = useState<View>(initial.view);
  const [years, setYears] = useState<[number, number] | null>(initial.years);
  const [topics, setTopics] = useState<string[]>(initial.topics);
  const [showCoverage, setShowCoverage] = useState(false);
  const firstSnapshot = useRef(true);

  useEffect(() => {
    fetch(dataPath)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CollectionIndex>;
      })
      .then((ix) => {
        setIndex(ix);
        const ok = ix.collections.filter((c) => c.availability === 'published' && c.snapshotPath);
        setCollection((cur) => (cur && ok.some((c) => c.id === cur) ? cur : ok[0]?.id ?? ix.collections[0]?.id ?? null));
        if (ok.length === 0) setLoading(false);
      })
      .catch((e: unknown) => {
        setIndexError(`Could not load collection index (${dataPath}): ${String(e)}`);
        setLoading(false);
      });
  }, [dataPath]);

  useEffect(() => {
    if (!index || !collection) return;
    const entry = index.collections.find((c) => c.id === collection);
    if (!entry?.snapshotPath) return;
    setLoading(true);
    setSnapError(null);
    fetch(new URL(entry.snapshotPath, window.location.href).toString())
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Snapshot>;
      })
      .then((s) => {
        setSnapshot(s);
        if (!firstSnapshot.current) {
          setSel(null);
          setYears(null);
          setTopics([]);
        }
        firstSnapshot.current = false;
      })
      .catch((e: unknown) => setSnapError(`Could not load snapshot: ${String(e)}`))
      .finally(() => setLoading(false));
  }, [index, collection, dataPath]);

  useEffect(() => {
    writeUrl({ data: initial.data, collection, sel, view, years, topics });
  }, [collection, sel, view, years, topics]);

  const idx = useMemo(() => (snapshot ? buildIndexes(snapshot) : null), [snapshot]);
  const extent = useMemo(() => (snapshot ? yearExtent(snapshot) : null), [snapshot]);
  const effectiveYears = useMemo<[number, number] | null>(() => {
    if (!years || !extent) return null;
    if (years[0] <= extent[0] && years[1] >= extent[1]) return null;
    return years;
  }, [years, extent]);
  const vis = useMemo(
    () => (snapshot ? computeVisibility(snapshot, { yearRange: effectiveYears, topics }) : null),
    [snapshot, effectiveYears, topics],
  );

  const selKind = useMemo(() => {
    if (!sel || !idx) return null;
    if (idx.researchers.has(sel)) return 'person';
    if (idx.works.has(sel)) return 'work';
    if (idx.candidates.has(sel)) return 'candidate';
    if (idx.edges.has(sel)) return 'edge';
    return 'missing';
  }, [sel, idx]);

  const onSelect = (id: string | null) => {
    setShowCoverage(false);
    setSel(id);
  };
  const onSearchPick = (h: SearchHit) => {
    if (h.kind === 'topic') {
      setTopics((t) => (t.includes(h.id) ? t : [...t, h.id]));
    } else onSelect(h.id);
  };

  const entry = index?.collections.find((c) => c.id === collection);
  const synthetic = snapshot?.meta.synthetic ?? entry?.synthetic ?? false;
  const panelOpen = showCoverage || (selKind != null && selKind !== 'missing');

  return (
    <div className="app">
      {synthetic && (
        <div className="synthetic-banner" role="alert" data-testid="synthetic-banner">
          SYNTHETIC FIXTURE — invented test records, not real research data.
        </div>
      )}
      <header className="header">
        <div className="brand">
          <span className="wordmark">Atlas</span>
          <span className="product">Research Atlas</span>
        </div>
        <label className="field">
          <span className="sr-only">Collection</span>
          <select
            aria-label="Collection"
            value={collection ?? ''}
            onChange={(e) => {
              setCollection(e.target.value);
            }}
          >
            {index?.collections.map((c) => (
              <option key={c.id} value={c.id} disabled={c.availability !== 'published' || !c.snapshotPath}>
                {c.label}
                {c.availability === 'not_collected' ? ` — ${c.note}` : ''}
              </option>
            ))}
          </select>
        </label>
        {snapshot && <SearchBox snapshot={snapshot} onPick={onSearchPick} />}
        <div className="header-actions">
          <div className="toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'constellation'} onClick={() => setView('constellation')}>
              Constellation
            </button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
          </div>
          <button type="button" onClick={() => setShowCoverage((v) => !v)} disabled={!snapshot} aria-pressed={showCoverage}>
            Coverage
          </button>
        </div>
      </header>

      {entry?.availability === 'not_collected' && (
        <p className="notice">
          {entry.label}: {entry.note} No real research data is published in this build.
        </p>
      )}
      {indexError && <div className="error" role="alert">{indexError}</div>}
      {snapError && <div className="error" role="alert">{snapError}</div>}
      {loading && !indexError && <div className="loading" role="status">Loading…</div>}
      {index && !loading && !snapshot && !indexError && !snapError && entry?.availability !== 'not_collected' && (
        <div className="notice">No published collection is available yet.</div>
      )}

      {snapshot && idx && vis && (
        <>
          <Filters
            snapshot={snapshot}
            extent={extent}
            years={years ?? extent}
            setYears={(y) => setYears(y && extent && y[0] <= extent[0] && y[1] >= extent[1] ? null : y)}
            topics={topics}
            setTopics={setTopics}
          />
          {selKind === 'missing' && (
            <div className="notice" role="status" data-testid="not-found">
              Item not found in this snapshot: <code>{sel}</code>{' '}
              <button type="button" onClick={() => setSel(null)}>Dismiss</button>
            </div>
          )}
          <main className={`main${panelOpen ? ' with-panel' : ''}`}>
            <section className="stage" aria-label={view === 'list' ? 'List view' : 'Constellation view'}>
              {vis.works.size === 0 ? (
                <div className="empty" role="status">No records match the current filters.</div>
              ) : view === 'constellation' ? (
                <>
                  <Constellation snapshot={snapshot} idx={idx} vis={vis} selected={sel} onSelect={onSelect} />
                  <Legend />
                </>
              ) : (
                <ListView snapshot={snapshot} vis={vis} onSelect={onSelect} selected={sel} />
              )}
            </section>
            {panelOpen && (
              <aside className="panel" data-testid="panel" aria-label="Details">
                <button type="button" className="close" aria-label="Close details" onClick={() => { setShowCoverage(false); setSel(null); }}>
                  ×
                </button>
                {showCoverage ? (
                  <CoveragePanel s={snapshot} />
                ) : selKind === 'person' ? (
                  <PersonPanel id={sel!} idx={idx} vis={vis} onSelect={onSelect} />
                ) : selKind === 'work' ? (
                  <WorkPanel id={sel!} idx={idx} onSelect={onSelect} />
                ) : selKind === 'candidate' ? (
                  <CandidatePanel c={idx.candidates.get(sel!)!} idx={idx} onSelect={onSelect} />
                ) : selKind === 'edge' ? (
                  <EdgePanel e={idx.edges.get(sel!)!} idx={idx} onSelect={onSelect} />
                ) : null}
              </aside>
            )}
          </main>
          <footer className="footer small muted">
            {snapshot.meta.attribution} · Snapshot {snapshot.meta.id} · Retrieved {snapshot.meta.retrievedAt?.slice(0, 10) ?? 'unknown'}
          </footer>
        </>
      )}
    </div>
  );
}

function SearchBox({ snapshot, onPick }: { snapshot: Snapshot; onPick: (h: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => search(snapshot, q), [snapshot, q]);
  const pick = (h: SearchHit) => {
    onPick(h);
    setOpen(false);
    setQ('');
  };
  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        type="search"
        placeholder="Search people, works, topics"
        aria-label="Search people, works, topics"
        role="combobox"
        aria-expanded={open && q.trim() !== ''}
        aria-controls="search-results"
        aria-activedescendant={open && hits[active] ? `hit-${active}` : undefined}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() !== '' && (
        <ul id="search-results" role="listbox" className="search-results">
          {hits.length === 0 ? (
            <li className="muted empty-hit" role="option" aria-selected={false} aria-disabled="true">No matches.</li>
          ) : (
            hits.map((h, i) => (
              <li
                key={`${h.kind}-${h.id}`}
                id={`hit-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              >
                <span className={`hit-kind kind-${h.kind}`}>{h.kind}</span> {h.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Filters({
  snapshot, extent, years, setYears, topics, setTopics,
}: {
  snapshot: Snapshot;
  extent: [number, number] | null;
  years: [number, number] | null;
  setYears: (y: [number, number] | null) => void;
  topics: string[];
  setTopics: (t: string[]) => void;
}) {
  const sortedTopics = useMemo(() => [...snapshot.topics].sort((a, b) => a.name.localeCompare(b.name)), [snapshot]);
  return (
    <div className="filters" aria-label="Filters">
      {extent && years && (
        <fieldset className="years">
          <legend>Years</legend>
          <label>
            From{' '}
            <input
              type="number"
              aria-label="From year"
              min={extent[0]}
              max={extent[1]}
              value={years[0]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setYears([v, Math.max(v, years[1])]);
              }}
            />
          </label>
          <label>
            to{' '}
            <input
              type="number"
              aria-label="To year"
              min={extent[0]}
              max={extent[1]}
              value={years[1]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setYears([Math.min(v, years[0]), v]);
              }}
            />
          </label>
        </fieldset>
      )}
      <details className="topics">
        <summary>Topics{topics.length ? ` (${topics.length} selected)` : ''}</summary>
        <div className="topic-list">
          {sortedTopics.map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                checked={topics.includes(t.id)}
                onChange={(e) => setTopics(e.target.checked ? [...topics, t.id] : topics.filter((x) => x !== t.id))}
              />{' '}
              {t.name}
            </label>
          ))}
        </div>
      </details>
      {topics.length > 0 && (
        <div className="chips">
          {topics.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => setTopics(topics.filter((x) => x !== t))} aria-label={`Remove topic filter ${snapshot.topics.find((x) => x.id === t)?.name ?? t}`}>
              {snapshot.topics.find((x) => x.id === t)?.name ?? t} ×
            </button>
          ))}
        </div>
      )}
      {(topics.length > 0 || years?.[0] !== extent?.[0] || years?.[1] !== extent?.[1]) && (
        <button type="button" onClick={() => { setTopics([]); setYears(null); }}>Clear filters</button>
      )}
    </div>
  );
}

function ListView({ snapshot, vis, onSelect, selected }: { snapshot: Snapshot; vis: ReturnType<typeof computeVisibility>; onSelect: (id: string) => void; selected: string | null }) {
  const works = snapshot.works.filter((w) => vis.works.has(w.id)).sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  const visiblePeople = new Set<string>();
  for (const w of works) for (const a of w.authorships) if (a.researcherId) visiblePeople.add(a.researcherId);
  const people = snapshot.researchers.filter((r) => visiblePeople.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="list-view" data-testid="list-view">
      <h2>People ({people.length})</h2>
      <table>
        <thead><tr><th scope="col">Name</th><th scope="col">Works in snapshot</th></tr></thead>
        <tbody>
          {people.map((r) => (
            <tr key={r.id} className={selected === r.id ? 'sel' : ''}>
              <td><button type="button" className="linklike" onClick={() => onSelect(r.id)}>{r.name}</button></td>
              <td>{r.workIds.filter((w) => vis.works.has(w)).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Works ({works.length})</h2>
      <table>
        <thead><tr><th scope="col">Title</th><th scope="col">Year</th><th scope="col">Authors</th></tr></thead>
        <tbody>
          {works.map((w) => (
            <tr key={w.id} className={selected === w.id ? 'sel' : ''}>
              <td><button type="button" className="linklike" onClick={() => onSelect(w.id)}>{w.title}</button></td>
              <td>{w.year ?? '—'}</td>
              <td>{w.authorships.slice(0, 3).map((a) => a.rawName).join(', ')}{w.authorships.length > 3 ? ` +${w.authorships.length - 3}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
