import { splitSessionByDay } from '../utils/time';

const dayMs = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 5, 9);

describe('splitSessionByDay', () => {
  it('splits a session of a few days into one segment per day', () => {
    const segments = splitSessionByDay(start, start + 2 * dayMs);
    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments.reduce((sum, segment) => sum + segment.durationMs, 0)).toBeLessThanOrEqual(2 * dayMs);
  });

  it('accepts a session of a full year', () => {
    expect(() => splitSessionByDay(start, start + 366 * dayMs)).not.toThrow();
  });

  it('rejects a session longer than a year instead of splitting it', () => {
    expect(() => splitSessionByDay(start, start + 367 * dayMs)).toThrow('A work session can last at most 366 days');
    expect(() => splitSessionByDay(-8.64e15, 8.64e15)).toThrow('A work session can last at most 366 days');
  });
});
