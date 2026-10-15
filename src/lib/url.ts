export type View = 'constellation' | 'list';

export interface UrlState {
  data: string | null;
  collection: string | null;
  sel: string | null;
  view: View;
  years: [number, number] | null;
  topics: string[];
}

export function readUrl(search: string = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  let years: [number, number] | null = null;
  const y = p.get('years');
  if (y) {
    const m = /^(\d{1,4})-(\d{1,4})$/.exec(y);
    if (m) years = [Number(m[1]), Number(m[2])];
  }
  const t = p.get('topics');
  return {
    data: p.get('data'),
    collection: p.get('c'),
    sel: p.get('sel'),
    view: p.get('view') === 'list' ? 'list' : 'constellation',
    years,
    topics: t ? t.split(',').filter(Boolean) : [],
  };
}

export function writeUrl(s: UrlState): void {
  const p = new URLSearchParams();
  if (s.data) p.set('data', s.data);
  if (s.collection) p.set('c', s.collection);
  if (s.sel) p.set('sel', s.sel);
  if (s.view !== 'constellation') p.set('view', s.view);
  if (s.years) p.set('years', `${s.years[0]}-${s.years[1]}`);
  if (s.topics.length) p.set('topics', s.topics.join(','));
  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', next);
  }
}
