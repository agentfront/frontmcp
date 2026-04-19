import { z } from '@frontmcp/lazy-zod';
import { FRONTMCP_CONTEXT, Tool, ToolContext } from '@frontmcp/sdk';

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

const inputSchema = {};

const outputSchema = z.object({
  sessionId: z.string().optional(),
  hasToken: z.boolean(),
  token: z.string().optional(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  userEmail: z.string().optional(),
});

type GetAuthInfoInput = z.infer<z.ZodObject<typeof inputSchema>>;
type GetAuthInfoOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-auth-info',
  description: 'Returns current auth context (for testing)',
  inputSchema,
  outputSchema,
})
export default class GetAuthInfoTool extends ToolContext {
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
