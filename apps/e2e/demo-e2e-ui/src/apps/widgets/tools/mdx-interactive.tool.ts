import React from 'react';

import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

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

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

// ═══════════════════════════════════════════════════════════════════
// CUSTOM MDX COMPONENTS
// These demonstrate how to pass custom React components to MDX templates
// ═══════════════════════════════════════════════════════════════════

const ALERT_COLORS: Record<string, React.CSSProperties> = {
  info: { background: '#e3f2fd', borderColor: '#90caf9', color: '#1565c0' },
  warning: { background: '#fff3e0', borderColor: '#ffcc80', color: '#e65100' },
  error: { background: '#ffebee', borderColor: '#ef9a9a', color: '#c62828' },
  success: { background: '#e8f5e9', borderColor: '#a5d6a7', color: '#2e7d32' },
};

const ALERT_ICONS: Record<string, string> = { info: 'i', warning: '!', error: 'x', success: '✓' };

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
}) =>
  React.createElement(
    'div',
    {
      className: `alert alert-${type}`,
      style: { padding: '12px 16px', borderRadius: 8, border: '1px solid', margin: '12px 0', ...ALERT_COLORS[type] },
    },
    React.createElement('span', { style: { marginRight: 8, fontWeight: 'bold' } }, `[${ALERT_ICONS[type]}]`),
    children,
  );

/**
 * Custom HighlightBox component for MDX templates
 * Shows how multiple custom components can be provided
 */
const HighlightBox = ({ title, children }: { title?: string; children: React.ReactNode }) =>
  React.createElement(
    'div',
    {
      className: 'highlight-box',
      style: {
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: 16,
        borderRadius: 12,
        margin: '12px 0',
      },
    },
    title && React.createElement('h4', { style: { margin: '0 0 8px 0', fontSize: 14, opacity: 0.9 } }, title),
    React.createElement('div', { style: { fontSize: 16 } }, children),
  );

@Tool({
  name: 'mdx-interactive',
  description: 'Generate an interactive MDX component with custom components',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays an interactive MDX document with custom Alert and HighlightBox components.',
    // The template is MDX, compiled once and rendered on the server for each call; its expressions read the
    // call's data, and its tags name these React components
    mdxComponents: { Alert, HighlightBox },
    template: `
# {output.topic}

<Alert type="info">
  This is an interactive MDX document with {(output.points ?? []).length} key points.
</Alert>

<HighlightBox title="Summary">
  Topic: **{output.topic}** with {(output.points ?? []).length} points to explore.
</HighlightBox>

## Key Points

<ul>{(output.points ?? []).map((point, index) => <li key={index}>{point}</li>)}</ul>

{output.hasCode ? <Alert type="success">Code example: <code>{input.codeExample}</code></Alert> : null}
`,
  },
})
export default class MdxInteractiveTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return {
      uiType: 'mdx',
      topic: input.topic,
      points: input.points,
      hasCode: !!input.codeExample,
    };
  }
}
