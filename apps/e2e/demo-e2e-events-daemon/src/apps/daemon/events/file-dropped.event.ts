import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** A file appeared in, or changed in, the drop folder the daemon watches. */
export const fileDropped = event({
  name: 'file.dropped',
  description: 'A file appeared or changed in the drop folder',
  inputSchema: { extension: z.string().optional().describe('Only files with this extension, such as ".pdf"') },
  payloadSchema: { name: z.string(), change: z.enum(['add', 'change']) },
  match: (occurrence, args) => args.extension === undefined || occurrence.data.name.endsWith(args.extension),
});
