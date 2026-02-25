import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {};

const outputSchema = z
  .object({
    sessionId: z.string().nullable(),
    hasSession: z.boolean(),
    authInfo: z.object({
      isAnonymous: z.boolean(),
      userSub: z.string().nullable(),
      scopes: z.array(z.string()),
    }),
    protocol: z.string().optional(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'session-info',
  description: 'Get information about the current transport session',
  inputSchema,
  outputSchema,
})
export default class SessionInfoTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const authInfo = this.getAuthInfo() as Record<string, unknown>;
    const sessionId = authInfo.sessionId as string | undefined;
    const hasSession = !!sessionId && sessionId.length > 0;

    return {
      sessionId: sessionId ?? null,
      hasSession,
      authInfo: {
        isAnonymous: (authInfo.isAnonymous as boolean) ?? false,
        userSub: (authInfo.user as { sub?: string })?.sub ?? null,
        scopes: (authInfo.scopes as string[]) ?? [],
      },
      protocol: 'streamable-http',
      message: hasSession ? `Session active: ${sessionId}` : 'No active session',
    };
  }
}
