import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { RememberAccessorToken, RememberAccessor } from '@frontmcp/plugin-remember';

@Prompt({
  name: 'memory-summary',
  description: 'Summarize all stored memories in session scope',
  arguments: [
    {
      name: 'scope',
      description: 'Scope to summarize (session, user, tool, global)',
      required: false,
    },
  ],
})
export default class MemorySummaryPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const scope = (args['scope'] ?? 'session') as 'session' | 'user' | 'tool' | 'global';
    const remember = this.get(RememberAccessorToken) as RememberAccessor;
    const keys = await remember.list({ scope });

    const memories: Record<string, unknown> = {};
    for (const key of keys) {
      const value = await remember.get(key, { scope });
      memories[key] = value;
    }

    const summary = `
Memory Summary for Scope: ${scope}
${'='.repeat(40)}

Total memories: ${keys.length}

${
  keys.length > 0
    ? Object.entries(memories)
        .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
        .join('\n')
    : 'No memories stored in this scope.'
}
`.trim();

    return {
      description: `Summary of memories in ${scope} scope`,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: summary },
        },
      ],
    };
  }
}
