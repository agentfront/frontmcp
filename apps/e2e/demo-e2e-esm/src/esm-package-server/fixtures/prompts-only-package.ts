/**
 * @file prompts-only-package.ts
 * @description ESM fixture with only @Prompt decorated classes as named exports.
 * The ESM loader detects decorated classes automatically — no manifest needed.
 */
import 'reflect-metadata';
import { Prompt } from '@frontmcp/sdk';

@Prompt({
  name: 'summarize',
  description: 'Summarize the provided text',
  arguments: [
    { name: 'text', description: 'Text to summarize', required: true },
    { name: 'style', description: 'Summary style (brief/detailed)', required: false },
  ],
})
export class SummarizePrompt {
  execute(args: Record<string, string>) {
    const style = args?.['style'] ?? 'brief';
    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please provide a ${style} summary of: ${args?.['text'] ?? ''}`,
          },
        },
      ],
    };
  }
}
