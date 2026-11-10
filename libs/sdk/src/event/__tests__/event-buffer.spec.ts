import { EventBuffer } from '../poll/event-buffer';

const NOW = 1_800_000_000_000;

function occurrence(name: string, id: string) {
  return { eventId: id, name, timestamp: new Date(NOW).toISOString(), data: { id } };
}

function idsOf(read: { events: Array<{ occurrence: { eventId: string } }> }): string[] {
  return read.events.map((buffered) => buffered.occurrence.eventId);
}

describe('EventBuffer', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the occurrences of an event published after a cursor, in order', () => {
    const buffer = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    const start = buffer.currentCursor();
    buffer.append(occurrence('order.created', 'evt_1'));
    buffer.append(occurrence('order.shipped', 'evt_2'));
    const middle = buffer.currentCursor();
    buffer.append(occurrence('order.created', 'evt_3'));

    expect(idsOf(buffer.read('order.created', start))).toEqual(['evt_1', 'evt_3']);
    expect(idsOf(buffer.read('order.created', middle))).toEqual(['evt_3']);
    expect(buffer.read('order.created', buffer.currentCursor())).toEqual({ events: [], truncated: false });
    expect(buffer.read('order.refunded', start)).toEqual({ events: [], truncated: false });
  });

  it('keeps who an occurrence is for, and when it was published', () => {
    const buffer = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    const start = buffer.currentCursor();

    const kept = buffer.append(occurrence('order.created', 'evt_1'), { roles: { any: ['admin'] } }, 'sub_0001');

    expect(kept).toEqual({
      sequence: 1,
      publishedAt: NOW,
      occurrence: occurrence('order.created', 'evt_1'),
      audience: { roles: { any: ['admin'] } },
      subscriptionId: 'sub_0001',
    });
    expect(buffer.read('order.created', start).events).toEqual([kept]);
  });

  it('gives a cursor for each position, of the shape <bootId>.<sequence>', () => {
    const buffer = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    const first = buffer.append(occurrence('order.created', 'evt_1'));
    buffer.append(occurrence('order.created', 'evt_2'));

    expect(buffer.currentCursor()).toMatch(/^[0-9a-f]{32}\.2$/);
    expect(idsOf(buffer.read('order.created', buffer.cursorAt(first.sequence)))).toEqual(['evt_2']);
  });

  it('drops the oldest occurrences of an event past maxEvents, and reads a cursor before them as a gap', () => {
    const buffer = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 2 });
    const start = buffer.currentCursor();
    buffer.append(occurrence('order.created', 'evt_1'));
    const afterFirst = buffer.currentCursor();
    buffer.append(occurrence('order.created', 'evt_2'));
    buffer.append(occurrence('order.shipped', 'evt_other'));
    buffer.append(occurrence('order.created', 'evt_3'));

    const fromStart = buffer.read('order.created', start);

    expect(idsOf(fromStart)).toEqual(['evt_2', 'evt_3']);
    expect(fromStart.truncated).toBe(true);
    expect(buffer.read('order.created', afterFirst)).toMatchObject({ truncated: false });
    expect(buffer.read('order.shipped', start).truncated).toBe(false);
  });

  it('drops occurrences older than maxAgeMs, at a read as well as at an append', () => {
    const buffer = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    const start = buffer.currentCursor();
    buffer.append(occurrence('order.created', 'evt_1'));
    jest.advanceTimersByTime(30_000);
    buffer.append(occurrence('order.created', 'evt_2'));
    const afterSecond = buffer.currentCursor();
    jest.advanceTimersByTime(30_001);

    const fromStart = buffer.read('order.created', start);

    expect(idsOf(fromStart)).toEqual(['evt_2']);
    expect(fromStart.truncated).toBe(true);

    jest.advanceTimersByTime(30_000);
    buffer.append(occurrence('order.created', 'evt_3'));
    expect(idsOf(buffer.read('order.created', afterSecond))).toEqual(['evt_3']);
    expect(buffer.read('order.created', afterSecond).truncated).toBe(false);
  });

  it.each([
    ['a cursor of another process', '0123456789abcdef0123456789abcdef.1'],
    ['a cursor that is not one', 'not a cursor'],
    ['an empty cursor', ''],
    ['a position that is not a whole number', 'BOOT.1.5'],
    ['a negative position', 'BOOT.-1'],
    ['a position written another way', 'BOOT.01'],
    ['a position this process has not reached', 'BOOT.99'],
  ])('reads %s as a gap, with nothing to replay', (_label, cursor) => {
    const buffer = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    buffer.append(occurrence('order.created', 'evt_1'));
    const bootId = buffer.currentCursor().split('.')[0];

    expect(buffer.read('order.created', cursor.replace('BOOT', bootId))).toEqual({ events: [], truncated: true });
  });

  it('gives two buffers cursors the other cannot place', () => {
    const one = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    const other = new EventBuffer({ maxAgeMs: 60_000, maxEvents: 10 });
    one.append(occurrence('order.created', 'evt_1'));
    other.append(occurrence('order.created', 'evt_2'));

    expect(other.read('order.created', one.cursorAt(0)).truncated).toBe(true);
  });
});
