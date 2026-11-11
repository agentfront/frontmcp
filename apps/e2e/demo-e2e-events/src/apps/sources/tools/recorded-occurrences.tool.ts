import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { recordedOccurrences } from '../jobs/record-occurrence.job';

@Tool({
  name: 'recorded-occurrences',
  description: 'The occurrences the event workflows were started with',
  inputSchema: {},
  outputSchema: { occurrences: z.array(z.record(z.string(), z.unknown())) },
})
export class RecordedOccurrencesTool extends ToolContext {
  async execute() {
    return { occurrences: [...recordedOccurrences] };
  }
}
