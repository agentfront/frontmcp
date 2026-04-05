import { Prompt, PromptContext } from '@frontmcp/sdk';
import { GetPromptResult } from '@frontmcp/protocol';

/**
 * Prompt constrained to Node.js runtime. Should be visible in e2e tests.
 */
@Prompt({
  name: 'node-debug',
  description: 'Debug prompt for Node.js environments',
  arguments: [{ name: 'topic', description: 'Debug topic', required: true }],
  availableWhen: { runtime: ['node'] },
})
export default class NodeDebugPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Debug ${args['topic']} in Node.js ${process.version}` },
        },
      ],
    };
  }
}
