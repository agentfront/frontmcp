import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** On a schedule, how many files the drop folder holds. */
export const folderSummary = event({
  name: 'folder.summary',
  description: 'How many files the drop folder holds, on a schedule',
  payloadSchema: { fileCount: z.number().int(), at: z.string() },
});
