import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'transform_data',
  description: 'Transform a key-value data object',
  inputSchema: {
    data: z
      .object({
        key: z.string(),
        value: z.string(),
      })
      .describe('Data object with key and value'),
    uppercase: z.boolean().optional().describe('Convert value to uppercase'),
  },
})
export default class TransformDataTool extends ToolContext {
  async execute(input: { data: { key: string; value: string }; uppercase?: boolean }) {
    const { data, uppercase } = input;
    const value = uppercase ? data.value.toUpperCase() : data.value;
    return { key: data.key, value };
  }
}
