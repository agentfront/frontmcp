import { z } from 'zod';

import { Job, JobContext } from '@frontmcp/sdk';

@Job({
  name: 'process-data',
  description: 'Process a data payload',
  inputSchema: {
    payload: z.string().describe('Data payload to process'),
  },
  outputSchema: {
    result: z.string().describe('Processing result'),
  },
})
export default class ProcessDataJob extends JobContext {
  async execute(input: { payload: string }) {
    return { result: `Processed: ${input.payload}` };
  }
}
