import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  status: z.string(),
  contentReceived: z.boolean(),
});

type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'connect-account',
  description: 'Demonstrates URL-mode elicitation. Sends the user to a page to connect an account.',
  inputSchema: {},
  outputSchema,
})
export default class ConnectAccountTool extends ToolContext {
  async execute(): Promise<Output> {
    const result = await this.elicit('Connect your billing account', z.object({}), {
      mode: 'url',
      url: 'https://billing.example/connect',
    });

    return { status: result.status, contentReceived: result.content !== undefined };
  }
}
