import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

import { conformanceState } from '../conformance-upstream';

/**
 * Test-only: an event read from an upstream that can replay, whose cursor is the position in that upstream. The
 * `conformance_upstream` tool makes it fail, skip ahead, or forget old positions.
 */
export const conformanceReplayed = event({
  name: 'conformance.replayed',
  description: 'Test-only: changes of an upstream that can replay',
  inputSchema: { topic: z.string().optional() },
  payloadSchema: { seq: z.number().int(), topic: z.string() },
  check(args, cursor, limits) {
    const state = conformanceState;
    if (state.failuresLeft > 0) {
      state.failuresLeft -= 1;
      throw new Error('the test upstream is unavailable');
    }
    const end = state.changes.length;
    if (cursor === null) return { events: [], cursor: String(end) };
    let position = Number(cursor);
    let truncated = false;
    if (!Number.isInteger(position) || position < state.retainedFrom || position > end || state.gapNext) {
      state.gapNext = false;
      position = end;
      truncated = true;
    }
    const batch = state.changes.slice(position, position + (limits?.maxEvents ?? end));
    const wanted = batch.filter((change) => args.topic === undefined || args.topic === change.topic);
    return {
      events: wanted.map((change) => ({ data: { seq: change.seq, topic: change.topic } })),
      cursor: String(position + batch.length),
      truncated,
      hasMore: position + batch.length < end,
    };
  },
});

/** Test-only: an event whose upstream cannot replay, so its cursor is always `null`. */
export const conformanceUnreplayable = event({
  name: 'conformance.unreplayable',
  description: 'Test-only: an upstream without replay',
  payloadSchema: { seq: z.number().int() },
  check() {
    return { events: [], cursor: null };
  },
});
