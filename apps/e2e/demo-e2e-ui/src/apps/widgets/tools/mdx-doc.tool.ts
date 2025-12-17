import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    title: z.string().describe('Document title'),
    sections: z
      .array(
        z.object({
          heading: z.string(),
          content: z.string(),
        }),
      )
      .describe('Document sections'),
  })
  .strict();

const outputSchema = z
  .object({
    uiType: z.literal('mdx'),
    title: z.string(),
    sectionCount: z.number(),
    mdxContent: z.string(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'mdx-doc',
  description: 'Generate an MDX document with sections',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays a formatted MDX document with sections.',
    template: (ctx) => {
      const { title, sectionCount, mdxContent } = ctx.output as unknown as Output;

      return `
# ${title}

*${sectionCount} sections*

${mdxContent}

---

<Note>This document was generated using MDX rendering.</Note>
      `;
    },
  },
})
export default class MdxDocTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const mdxContent = input.sections.map((section) => `## ${section.heading}\n\n${section.content}`).join('\n\n');

    return {
      uiType: 'mdx',
      title: input.title,
      sectionCount: input.sections.length,
      mdxContent,
    };
  }
}
