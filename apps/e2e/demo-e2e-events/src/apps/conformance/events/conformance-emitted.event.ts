import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** Test-only: an emit-only event the `conformance_emit` tool publishes, offered in every mode. */
export const conformanceEmitted = event({
  name: 'conformance.emitted',
  description: 'Test-only: occurrences the conformance_emit tool publishes',
  inputSchema: { topic: z.string().optional().describe('Only occurrences of this topic') },
  payloadSchema: { seq: z.number().int(), topic: z.string() },
  match: (occurrence, args) => args.topic === undefined || args.topic === occurrence.data.topic,
});
