import { Prompt, PromptContext } from '@frontmcp/sdk';

/**
 * Admin-only prompt. `checkEntryAuthorities` on `prompts/get` blocks non-admins
 * and `prompts/list` filters it out of their discovery.
 */
@Prompt({
  name: 'admin-briefing',
  description: 'Admin-only daily briefing.',
  arguments: [{ name: 'date', description: 'ISO date', required: true }],
  authorities: 'admin',
})
export default class AdminBriefingPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return {
      description: `Admin briefing for ${args['date']}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Compile the admin briefing for ${args['date']} including restricted incident reports.`,
          },
        },
      ],
    };
  }
}
