import { z } from '@frontmcp/lazy-zod';

import { findUndeclaredArguments } from '../undeclared-arguments';
import { describeUndeclaredArguments } from '../undeclared-arguments-message';

describe('findUndeclaredArguments', () => {
  const shape = {
    timeoutSec: z.number().optional(),
    filter: z.object({ status: z.string() }).optional(),
    window: z
      .object({ from: z.string() })
      .transform(({ from }) => ({ start: from }))
      .optional(),
  };

  function undeclared(sent: Record<string, unknown>): string[] {
    return findUndeclaredArguments(shape, sent, z.object(shape).parse(sent));
  }

  it('names the top-level and nested keys parsing dropped', () => {
    expect(undeclared({ timeoutMs: 5, filter: { status: 'open', owner: 'me' } })).toEqual([
      'filter.owner',
      'timeoutMs',
    ]);
  });

  it('names nothing when every key is declared', () => {
    expect(undeclared({ timeoutSec: 5, filter: { status: 'open' } })).toEqual([]);
  });

  it('compares nothing below a field whose schema transforms it', () => {
    expect(undeclared({ window: { from: 'monday' } })).toEqual([]);
  });
});

describe('describeUndeclaredArguments', () => {
  it('names the declared key closest to a slip', () => {
    expect(describeUndeclaredArguments(['timeoutMs'], ['timeoutSec', 'query'])).toBe(
      "'timeoutMs' (did you mean 'timeoutSec'?)",
    );
  });

  it('suggests nothing for a key far from every declared one, or for a nested key', () => {
    expect(describeUndeclaredArguments(['color', 'filter.owner'], ['timeoutSec'])).toBe("'color', 'filter.owner'");
  });

  it('matches regardless of case', () => {
    expect(describeUndeclaredArguments(['UserId'], ['userId'])).toBe("'UserId' (did you mean 'userId'?)");
  });
});
