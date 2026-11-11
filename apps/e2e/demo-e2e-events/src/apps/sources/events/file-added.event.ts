import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** Fires when a file appears in the folder the inbox watcher watches. */
export const fileAdded = event({
  name: 'file.added',
  description: 'Fires when a file appears in the watched folder',
  payloadSchema: { name: z.string() },
});
