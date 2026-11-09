/**
 * Markdown Table Tool - a Markdown template converted with `ui.runtimeOptions.markdown`:
 * GitHub-flavored tables and task lists, and code highlighted with a highlight.js theme.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  quarter: z.string().describe('Quarter to report'),
};

const outputSchema = z.object({ quarter: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'markdown-table',
  description: 'Display a sales table, a checklist and a code sample in GitHub-flavored Markdown',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'static',
    runtimeOptions: { markdown: { gfm: true, highlightTheme: 'github' } },
    template: [
      '## Sales',
      '',
      '| Region | Sales |',
      '|:---|---:|',
      '| EU | 12 |',
      '| US | 30 |',
      '',
      '- [x] Collect',
      '- [ ] ~~Guess~~ Review',
      '',
      '```ts',
      'const total = 12 + 30;',
      '```',
    ].join('\n'),
  },
})
export default class MarkdownTableTool extends ToolContext {
  async execute(input: Input) {
    return { quarter: input.quarter };
  }
}
