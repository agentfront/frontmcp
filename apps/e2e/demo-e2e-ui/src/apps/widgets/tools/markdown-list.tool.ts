import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  title: z.string().describe('List title'),
  items: z
    .array(
      z.object({
        text: z.string(),
        completed: z.boolean().optional(),
      }),
    )
    .describe('List items'),
  ordered: z.boolean().optional().describe('Use ordered list'),
};

const outputSchema = z.object({
  uiType: z.literal('markdown'),
  title: z.string(),
  itemCount: z.number(),
  completedCount: z.number(),
  markdown: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'markdown-list',
  description: 'Generate a markdown list',
  inputSchema,
  outputSchema,
  ui: {
    uiType: 'markdown',
    template: (ctx) => {
      const { title, itemCount, completedCount, markdown } = ctx.output as unknown as Output;

      return `
# ${title}

**${completedCount}/${itemCount} completed**

${markdown}
      `;
    },
  },
})
export default class MarkdownListTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const completedCount = input.items.filter((i) => i.completed).length;

    const listItems = input.items.map((item, idx) => {
      const prefix = input.ordered ? `${idx + 1}.` : '-';
      const checkbox = item.completed ? '[x]' : '[ ]';
      return `${prefix} ${checkbox} ${item.text}`;
    });

    const markdown = listItems.join('\n');

    return {
      uiType: 'markdown',
      title: input.title,
      itemCount: input.items.length,
      completedCount,
      markdown,
    };
  }
}
