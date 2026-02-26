import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getSessionStore } from '../../sessions/data/session.store';

const inputSchema = {
  key: z.string().describe('State key to update'),
  value: z.string().describe('State value'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    sessionId: z.string().nullable(),
    stateKey: z.string(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'update-session-state',
  description: 'Update transport session state',
  inputSchema,
  outputSchema,
})
export default class UpdateSessionStateTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const store = getSessionStore(sessionId);

    // Store transport state under a prefixed key
    const stateKey = `__transport_state__:${input.key}`;
    store.set(stateKey, input.value);

    return {
      success: true,
      sessionId,
      stateKey: input.key,
      message: `Updated transport state "${input.key}" for session ${sessionId}`,
    };
  }
}
