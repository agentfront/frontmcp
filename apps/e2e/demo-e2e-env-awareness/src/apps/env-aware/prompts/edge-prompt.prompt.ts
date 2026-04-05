import { Prompt, PromptContext } from '@frontmcp/sdk';
import { GetPromptResult } from '@frontmcp/protocol';

/**
 * Prompt constrained to edge runtime. Should NOT be visible in e2e tests.
 */
@Prompt({
  name: 'edge-prompt',
  description: 'Prompt for edge runtime only (should be filtered)',
  arguments: [{ name: 'topic', required: true }],
  availableWhen: { runtime: ['edge'] },
})
export default class EdgePrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Edge: ${args['topic']}` },
        },
      ],
    };
  }
}
