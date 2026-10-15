import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../types/contract';
import { computeVisibility, yearExtent } from './filter';
import fixture from './filter.fixture.json';

const snap = fixture as unknown as Snapshot;

describe('computeVisibility', () => {
  it('shows everything with no filters', () => {
    const v = computeVisibility(snap, { yearRange: null, topics: [] });
    expect(v.works.size).toBe(snap.works.length);
    expect(v.edges.size).toBe(snap.edges.length);
    expect(v.candidates.size).toBe(snap.candidates.length);
  });

  it('year filter hides works, their edges and candidates whose pairs fail', () => {
    const v = computeVisibility(snap, { yearRange: [2020, 2022], topics: [] });
    expect(v.works.has('SYN-W1')).toBe(false);
    expect(v.works.has('SYN-W2')).toBe(true);
    expect(v.edges.has('E-AU-1')).toBe(false); // AUTHORED to W1
    expect(v.edges.has('E-AU-3')).toBe(true);
    expect(v.edges.has('E-CO-1')).toBe(false); // only evidence W1
    expect(v.edges.has('E-CI-5')).toBe(false); // CITES W3 -> W1, W1 endpoint fails
    expect(v.edges.has('E-SR-1')).toBe(false); // shared-reference edge needs both works (W1 excluded)
    expect(v.edges.has('E-CC-1')).toBe(false); // candidate pair needs both works
    expect(v.candidates.has('C-1')).toBe(false);
  });

  it('works with null year fail a year filter', () => {
    const s: Snapshot = { ...snap, works: snap.works.map((w) => (w.id === 'SYN-W2' ? { ...w, year: null } : w)) };
    const v = computeVisibility(s, { yearRange: [1900, 2100], topics: [] });
    expect(v.works.has('SYN-W2')).toBe(false);
  });

  it('topic filter keeps works with any selected topic', () => {
    const v = computeVisibility(snap, { yearRange: null, topics: ['SYN-T2'] });
    expect([...v.works].sort()).toEqual(['SYN-W2', 'SYN-W3']);
    expect(v.edges.has('E-TO-1')).toBe(false);
    expect(v.candidates.has('C-1')).toBe(false);
  });

  it('yearExtent', () => {
    expect(yearExtent(snap)).toEqual([2019, 2022]);
  });
});
