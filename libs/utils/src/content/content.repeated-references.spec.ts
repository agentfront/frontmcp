import { sanitizeToJson } from './content';

describe('sanitizeToJson with repeated (non-cyclic) references', () => {
  it('keeps an object that is referenced by two properties', () => {
    const alice = { id: 'u1', name: 'Alice' };

    expect(sanitizeToJson({ id: 'T-1', reporter: alice, assignee: alice })).toEqual({
      id: 'T-1',
      reporter: { id: 'u1', name: 'Alice' },
      assignee: { id: 'u1', name: 'Alice' },
    });
  });

  it('keeps an object that appears twice in an array', () => {
    const urgent = { label: 'urgent' };

    expect(sanitizeToJson({ tags: [urgent, urgent] })).toEqual({ tags: [{ label: 'urgent' }, { label: 'urgent' }] });
  });

  it('keeps an array that is referenced by two properties', () => {
    const labels = ['a', 'b'];

    expect(sanitizeToJson({ current: labels, previous: labels })).toEqual({
      current: ['a', 'b'],
      previous: ['a', 'b'],
    });
  });

  it('matches JSON.stringify for a value with repeated references and no cycles', () => {
    const shared = { nested: { value: 1 } };
    const value = { first: shared, second: [shared, { again: shared }] };

    expect(sanitizeToJson(value)).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('drops a Map entry that points back at the Map itself', () => {
    const registry = new Map<string, unknown>([['name', 'root']]);
    registry.set('self', registry);

    expect(sanitizeToJson(registry)).toEqual({ name: 'root', self: undefined });
  });
});
