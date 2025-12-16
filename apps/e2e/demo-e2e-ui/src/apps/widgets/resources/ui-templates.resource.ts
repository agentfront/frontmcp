import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';

const outputSchema = z.object({
  uiTypes: z.array(
    z.object({
      type: z.string(),
      tools: z.array(z.string()),
      description: z.string(),
    }),
  ),
  totalTools: z.number(),
});

@Resource({
  uri: 'widgets://templates',
  name: 'UI Templates',
  description: 'Available UI template types and tools',
  mimeType: 'application/json',
})
export default class UiTemplatesResource extends ResourceContext<Record<string, never>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return {
      uiTypes: [
        {
          type: 'html',
          tools: ['html-table', 'html-card'],
          description: 'Plain HTML templates with optional Handlebars enhancement',
        },
        {
          type: 'react',
          tools: ['react-chart', 'react-form'],
          description: 'React component templates with SSR support',
        },
        {
          type: 'mdx',
          tools: ['mdx-doc', 'mdx-interactive'],
          description: 'MDX templates combining Markdown and JSX',
        },
        {
          type: 'markdown',
          tools: ['markdown-report', 'markdown-list'],
          description: 'Pure Markdown templates for documentation',
        },
      ],
      totalTools: 8,
    };
  }
}
