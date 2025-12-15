import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';
import { getSessionStore } from '../data/session.store';

@Prompt({
  name: 'session-summary',
  description: 'Summarize the current session data',
  arguments: [],
})
export default class SessionSummaryPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const sessionId = 'mock-session-' + Date.now();
    const store = getSessionStore(sessionId);
    const data = store.getAll();
    const keys = Object.keys(data);

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please summarize the following session data:

Session ID: ${sessionId}
Total keys: ${keys.length}
Keys: ${keys.join(', ') || 'No data stored'}

Data:
${keys.map((k) => `- ${k}: ${data[k]}`).join('\n') || 'Empty session'}`,
          },
        },
      ],
      description: `Session summary for ${sessionId}`,
    };
  }
}
