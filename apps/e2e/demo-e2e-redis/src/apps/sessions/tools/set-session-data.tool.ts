import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getSessionStore } from '../data/session.store';

const inputSchema = {
  key: z.string().describe('Key to store'),
  value: z.string().describe('Value to store'),
  ttlSeconds: z.number().optional().describe('Time to live in seconds'),
};

const outputSchema = z.object({
  success: z.boolean(),
  key: z.string(),
  message: z.string(),
});

@Tool({
  name: 'set-session-data',
  description: 'Store data in the session',
  inputSchema,
  outputSchema,
})
export default class SetSessionDataTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = 'mock-session-' + Date.now();
    const store = getSessionStore(sessionId);

    store.set(input.key, input.value, input.ttlSeconds);

    return {
      success: true,
      key: input.key,
      message: `Stored key "${input.key}" in session ${sessionId}`,
    };
  }
}
