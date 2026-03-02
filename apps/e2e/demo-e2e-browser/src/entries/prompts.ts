import { Prompt, PromptContext } from '@frontmcp/react';
import type { GetPromptResult } from '@frontmcp/react';

// ─── Summarize Prompt ────────────────────────────────────────────────────────

@Prompt({
  name: 'summarize',
  description: 'Generate a summarization prompt for given text',
  arguments: [{ name: 'text', description: 'The text to summarize', required: true }],
})
export class SummarizePrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please summarize the following text concisely:\n\n${args.text}`,
          },
        },
      ],
    };
  }
}

// ─── Code Review Prompt ──────────────────────────────────────────────────────

@Prompt({
  name: 'code_review',
  description: 'Generate a code review prompt',
  arguments: [
    { name: 'language', description: 'Programming language', required: true },
    { name: 'code', description: 'Code to review', required: true },
  ],
})
export class CodeReviewPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please review the following ${args.language} code for best practices, bugs, and improvements:\n\n\`\`\`${args.language}\n${args.code}\n\`\`\``,
          },
        },
      ],
    };
  }
}
