import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'sign-up',
  description: 'Signs a user up, emitting user.signup on the server',
  inputSchema: { email: z.string() },
  outputSchema: { emitted: z.boolean() },
})
export class SignUpTool extends ToolContext {
  async execute(input: { email: string }) {
    const bus = this.scope.channelEventBus;
    bus?.emit('user.signup', { email: input.email });
    return { emitted: bus !== undefined };
  }
}
