import { describe, expect, it } from 'vitest';

import { formatAge, formatDuration, parseServerDate } from './format';

describe('formatDuration', () => {
  it('renders sub-hour durations as minutes', () => {
    expect(formatDuration(2520)).toBe('42m');
  });

  it('renders hour durations with zero-padded minutes', () => {
    expect(formatDuration(3900)).toBe('1h 05m');
  });

  it('renders sub-minute durations', () => {
    expect(formatDuration(30)).toBe('<1m');
  });

  it('renders multi-day durations', () => {
    expect(formatDuration(2 * 86400 + 3 * 3600)).toBe('2d 3h');
  });
});

describe('parseServerDate', () => {
  it('treats offset-less server timestamps as UTC', () => {
    const parsed = parseServerDate('2026-07-22T12:00:00');
    expect(parsed.toISOString()).toBe('2026-07-22T12:00:00.000Z');
  });

  it('respects an explicit offset', () => {
    const parsed = parseServerDate('2026-07-22T12:00:00+02:00');
    expect(parsed.toISOString()).toBe('2026-07-22T10:00:00.000Z');
  });
});

describe('formatAge', () => {
  it('computes age against a fixed now', () => {
    const now = new Date('2026-07-22T13:05:00Z');
    expect(formatAge('2026-07-22T12:00:00', now)).toBe('1h 05m');
  });
});
