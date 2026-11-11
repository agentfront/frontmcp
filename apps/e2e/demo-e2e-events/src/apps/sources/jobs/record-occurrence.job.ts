import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext } from '@frontmcp/sdk';

/** The occurrences the event workflows received as their input, in order. */
export const recordedOccurrences: Array<Record<string, unknown>> = [];

const inputSchema = {
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()),
};

@Job({
  name: 'record-occurrence',
  description: 'Records the occurrence its workflow run was started with',
  inputSchema,
  outputSchema: { recorded: z.number() },
})
export class RecordOccurrenceJob extends JobContext {
  async execute(occurrence: z.infer<z.ZodObject<typeof inputSchema>>) {
    recordedOccurrences.push(occurrence);
    return { recorded: recordedOccurrences.length };
  }
}
