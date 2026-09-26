import { ResolvedEntries } from '../resolved-entries';

describe('ResolvedEntries', () => {
  const entry = { name: 'list_orders' };

  it('hands the entry kept for a run to that run once', () => {
    const resolved = new ResolvedEntries<typeof entry>();
    const rawInput = {};

    resolved.remember(rawInput, 'list_orders', entry);

    expect(resolved.take(rawInput, 'list_orders')).toBe(entry);
    expect(resolved.take(rawInput, 'list_orders')).toBeUndefined();
  });

  it('does not hand an entry to another run', () => {
    const resolved = new ResolvedEntries<typeof entry>();
    resolved.remember({}, 'list_orders', entry);

    expect(resolved.take({}, 'list_orders')).toBeUndefined();
  });

  it('does not hand out an entry resolved from another key', () => {
    const resolved = new ResolvedEntries<typeof entry>();
    const rawInput = {};
    resolved.remember(rawInput, 'list_orders', entry);

    expect(resolved.take(rawInput, 'get_order')).toBeUndefined();
    expect(resolved.take(rawInput, 'list_orders')).toBeUndefined();
  });

  it('keeps nothing for a raw input that is not an object', () => {
    const resolved = new ResolvedEntries<typeof entry>();

    resolved.remember('list_orders', 'list_orders', entry);

    expect(resolved.take('list_orders', 'list_orders')).toBeUndefined();
    expect(resolved.take(undefined, 'list_orders')).toBeUndefined();
  });
});
