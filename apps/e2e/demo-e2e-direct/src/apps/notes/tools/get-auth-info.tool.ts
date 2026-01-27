import { Tool, ToolContext, FRONTMCP_CONTEXT } from '@frontmcp/sdk';
import { z } from 'zod';

/**
 * Auth info structure for DirectClient connections.
 * User info is stored directly in authInfo when connecting via DirectClient.
 */
interface DirectAuthInfo {
  token?: string;
  user?: {
    iss?: string;
    sub?: string;
    name?: string;
    email?: string;
    [key: string]: unknown;
  };
}

const inputSchema = z.object({}).strict();

const outputSchema = z.object({
  sessionId: z.string().optional(),
  hasToken: z.boolean(),
  token: z.string().optional(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  userEmail: z.string().optional(),
});

type GetAuthInfoInput = z.infer<typeof inputSchema>;
type GetAuthInfoOutput = z.infer<typeof outputSchema>;

/**
 * Tool to verify auth context is passed correctly.
 * Used for E2E testing of connect utilities.
 */
@Tool({
  name: 'get-auth-info',
  description: 'Returns current auth context (for testing)',
  inputSchema,
  outputSchema,
})
export default class GetAuthInfoTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: GetAuthInfoInput): Promise<GetAuthInfoOutput> {
    const ctx = this.tryGet(FRONTMCP_CONTEXT);

    if (!ctx) {
      return {
        sessionId: undefined,
        hasToken: false,
        token: undefined,
        userId: undefined,
        userName: undefined,
        userEmail: undefined,
      };
    }

    const authInfo = ctx.authInfo as DirectAuthInfo | undefined;
    // User info is stored directly in authInfo (from DirectClient), not in extra
    const user = authInfo?.user;

    return {
      sessionId: ctx.sessionId,
      hasToken: !!authInfo?.token,
      token: authInfo?.token,
      userId: user?.sub as string | undefined,
      userName: user?.name as string | undefined,
      userEmail: user?.email as string | undefined,
    };
  }
}
