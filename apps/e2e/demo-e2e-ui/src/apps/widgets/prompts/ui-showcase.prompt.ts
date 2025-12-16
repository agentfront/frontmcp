import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';

@Prompt({
  name: 'ui-showcase',
  description: 'Showcase all available UI tools and their capabilities',
  arguments: [],
})
export default class UiShowcasePrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `# UI Tools Showcase

This server provides 8 UI tools across 4 different rendering types:

## HTML Type (Plain HTML)
1. **html-table** - Generate data tables with custom headers and rows
2. **html-card** - Create styled card components with title, content, and footer

## React Type (SSR Components)
3. **react-chart** - Create interactive bar charts with data visualization
4. **react-form** - Build dynamic forms with various field types

## MDX Type (Markdown + JSX)
5. **mdx-doc** - Generate documentation with sections
6. **mdx-interactive** - Create interactive MDX with callouts and buttons

## Markdown Type (Pure Markdown)
7. **markdown-report** - Generate reports with findings and severity levels
8. **markdown-list** - Create checklists with completion tracking

Each tool demonstrates a different UI rendering approach and can be customized based on platform capabilities.`,
          },
        },
      ],
      description: 'UI tools showcase and capabilities overview',
    };
  }
}
