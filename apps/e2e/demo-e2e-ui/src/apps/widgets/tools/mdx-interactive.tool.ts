import React from 'react';
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  topic: z.string().describe('Interactive topic'),
  points: z.array(z.string()).describe('Key points to display'),
  codeExample: z.string().optional().describe('Optional code example'),
};

const outputSchema = z
  .object({
    uiType: z.literal('mdx'),
    topic: z.string(),
    points: z.array(z.string()),
    hasCode: z.boolean(),
  })
  .strict();

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

// ═══════════════════════════════════════════════════════════════════
// CUSTOM MDX COMPONENTS
// These demonstrate how to pass custom React components to MDX templates
// ═══════════════════════════════════════════════════════════════════

/**
 * Custom Alert component for MDX templates
 * Demonstrates the mdxComponents feature for custom styling
 */
const Alert = ({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning' | 'error' | 'success';
  children: React.ReactNode;
}) => {
  const colors: Record<string, string> = {
    info: 'background: #e3f2fd; border-color: #90caf9; color: #1565c0',
    warning: 'background: #fff3e0; border-color: #ffcc80; color: #e65100',
    error: 'background: #ffebee; border-color: #ef9a9a; color: #c62828',
    success: 'background: #e8f5e9; border-color: #a5d6a7; color: #2e7d32',
  };

  const icons: Record<string, string> = {
    info: 'i',
    warning: '!',
    error: 'x',
    success: '✓',
  };

  return React.createElement(
    'div',
    {
      style: `padding: 12px 16px; border-radius: 8px; border: 1px solid; margin: 12px 0; ${colors[type]}`,
    },
    React.createElement('span', { style: 'margin-right: 8px; font-weight: bold' }, `[${icons[type]}]`),
    children,
  );
};

/**
 * Custom HighlightBox component for MDX templates
 * Shows how multiple custom components can be provided
 */
const HighlightBox = ({ title, children }: { title?: string; children: React.ReactNode }) => {
  return React.createElement(
    'div',
    {
      style:
        'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px; border-radius: 12px; margin: 12px 0',
    },
    title && React.createElement('h4', { style: 'margin: 0 0 8px 0; font-size: 14px; opacity: 0.9' }, title),
    React.createElement('div', { style: 'font-size: 16px' }, children),
  );
};

@Tool({
  name: 'mdx-interactive',
  description: 'Generate an interactive MDX component with custom components',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays an interactive MDX document with custom Alert and HighlightBox components.',
    // Custom MDX components - these React components are available in the MDX template
    mdxComponents: { Alert, HighlightBox },
    template: (ctx) => {
      const { topic, points, hasCode } = ctx.output as unknown as Output;
      const codeExample = (ctx.input as unknown as Input).codeExample;

      const pointsList = points.map((p) => `- ${p}`).join('\n');

      return `
# ${topic}

<Alert type="info">
  This is an interactive MDX document with ${points.length} key points.
</Alert>

<HighlightBox title="Summary">
  Topic: **${topic}** with ${points.length} points to explore.
</HighlightBox>

## Key Points

${pointsList}

${
  hasCode
    ? `
## Code Example

\`\`\`typescript
${codeExample}
\`\`\`

<Alert type="success">
  Code example included above!
</Alert>
`
    : ''
}

<Button onClick={() => console.log('Clicked!')}>
  Learn More
</Button>
      `;
    },
  },
})
export default class MdxInteractiveTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      uiType: 'mdx',
      topic: input.topic,
      points: input.points,
      hasCode: !!input.codeExample,
    };
  }
}
