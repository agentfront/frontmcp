import { Prompt, PromptContext } from '@frontmcp/sdk';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

@Prompt({
  name: 'flag-report',
  description: 'Prompt gated behind a feature flag (disabled)',
  arguments: [],
  featureFlag: 'flag-for-prompt',
})
export default class FlagReportPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'This prompt should NOT be visible because flag-for-prompt is disabled.',
          },
        },
      ],
    };
  }
}
