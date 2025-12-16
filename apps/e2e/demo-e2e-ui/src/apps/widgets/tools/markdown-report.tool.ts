import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    title: z.string().describe('Report title'),
    summary: z.string().describe('Executive summary'),
    findings: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
          severity: z.enum(['low', 'medium', 'high']),
        }),
      )
      .describe('Report findings'),
  })
  .strict();

const outputSchema = z
  .object({
    uiType: z.literal('markdown'),
    title: z.string(),
    findingCount: z.number(),
    markdown: z.string(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'markdown-report',
  description: 'Generate a markdown report',
  inputSchema,
  outputSchema,
  ui: {
    uiType: 'markdown',
    template: (ctx) => {
      const { title, findingCount, markdown } = ctx.output as unknown as Output;

      return `
# ${title}

**Total Findings: ${findingCount}**

${markdown}

---

*Report generated automatically*
      `;
    },
  },
})
export default class MarkdownReportTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const severityEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🔴',
    };

    const findingsMarkdown = input.findings
      .map(
        (f) => `### ${severityEmoji[f.severity]} ${f.title}

**Severity:** ${f.severity.toUpperCase()}

${f.description}`,
      )
      .join('\n\n');

    const markdown = `## Summary

${input.summary}

## Findings

${findingsMarkdown}`;

    return {
      uiType: 'markdown',
      title: input.title,
      findingCount: input.findings.length,
      markdown,
    };
  }
}
