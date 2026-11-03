import type { StallReport } from '../stalls/stall-detector';
import { countStall, describeStall, STALL_SECONDS_COUNTER } from '../stalls/stall-report';

const busy = { method: 'tools/call' as const, entry: 'probe:busy-wait', session: 'a1b2c3d4e5f6', runningMs: 598 };

function recordingCounter() {
  const counts: Array<{ by: number; attributes: Record<string, string> }> = [];
  return {
    counts,
    counter: { name: STALL_SECONDS_COUNTER, inc: (by = 1, attributes = {}) => counts.push({ by, attributes }) },
  };
}

describe('describeStall', () => {
  it('names each call in flight with its method, entry, running time and session hash', () => {
    const report: StallReport = { stallMs: 600, gcMs: 0, cause: 'calls', calls: [busy] };

    expect(describeStall(report)).toBe(
      'Event loop stalled for 600 ms while running tools/call probe:busy-wait (598 ms, session a1b2c3d4e5f6)',
    );
  });

  it('says how much of the stall garbage collection took', () => {
    expect(describeStall({ stallMs: 600, gcMs: 40, cause: 'calls', calls: [{ ...busy, session: undefined }] })).toBe(
      'Event loop stalled for 600 ms (40 ms in garbage collection) while running tools/call probe:busy-wait (598 ms)',
    );
  });

  it('does not blame the calls in flight for a stall garbage collection took up', () => {
    expect(describeStall({ stallMs: 300, gcMs: 260, cause: 'gc', calls: [busy] })).toBe(
      'Event loop stalled for 300 ms, 260 ms of it in garbage collection',
    );
  });

  it('says when no call was in flight', () => {
    expect(describeStall({ stallMs: 250, gcMs: 0, cause: 'unknown', calls: [] })).toBe(
      'Event loop stalled for 250 ms with no call in flight',
    );
  });

  it('names at most five calls and counts the rest, so the line stays short', () => {
    const calls = Array.from({ length: 8 }, (_, index) => ({ ...busy, entry: `tool-${index}`, session: undefined }));
    const line = describeStall({ stallMs: 300, gcMs: 0, cause: 'calls', calls });

    expect(line).toContain('tools/call tool-4 (598 ms)');
    expect(line).not.toContain('tool-5');
    expect(line.endsWith('and 3 more')).toBe(true);
  });
});

describe('countStall', () => {
  it('adds the stall seconds to each entry in flight once, labelled by method and entry', () => {
    const { counts, counter } = recordingCounter();
    countStall({ stallMs: 600, gcMs: 0, cause: 'calls', calls: [busy, { ...busy, session: 'other' }] }, counter);

    expect(counts).toEqual([{ by: 0.6, attributes: { cause: 'tools/call', entry: 'probe:busy-wait' } }]);
  });

  it('adds GC time under the gc cause and the rest to the calls', () => {
    const { counts, counter } = recordingCounter();
    countStall({ stallMs: 600, gcMs: 100, cause: 'calls', calls: [busy] }, counter);

    expect(counts).toEqual([
      { by: 0.1, attributes: { cause: 'gc', entry: '' } },
      { by: 0.5, attributes: { cause: 'tools/call', entry: 'probe:busy-wait' } },
    ]);
  });

  it('adds only GC time for a GC stall, and unattributed time when no call was in flight', () => {
    const gc = recordingCounter();
    countStall({ stallMs: 300, gcMs: 260, cause: 'gc', calls: [busy] }, gc.counter);
    expect(gc.counts).toEqual([{ by: 0.26, attributes: { cause: 'gc', entry: '' } }]);

    const none = recordingCounter();
    countStall({ stallMs: 250, gcMs: 0, cause: 'unknown', calls: [] }, none.counter);
    expect(none.counts).toEqual([{ by: 0.25, attributes: { cause: 'unknown', entry: '' } }]);
  });
});
