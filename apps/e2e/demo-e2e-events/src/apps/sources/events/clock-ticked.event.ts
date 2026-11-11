import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** Fires on each tick of the background code that publishes it. A subscription may ask for one source only. */
export const clockTicked = event({
  name: 'clock.ticked',
  description: 'Fires on each tick of a worker or a duty',
  inputSchema: { source: z.string().optional() },
  payloadSchema: { source: z.enum(['worker', 'duty']), tick: z.number() },
  match(occurrence, args) {
    return args.source === undefined || args.source === occurrence.data.source;
  },
});
