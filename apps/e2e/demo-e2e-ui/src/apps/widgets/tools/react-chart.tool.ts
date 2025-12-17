/**
 * React Chart Tool with React UI
 *
 * Demonstrates how to use React components for Tool UI templates.
 * The UI is defined as a React component and rendered via the React renderer.
 */

import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import ChartCard from './chart-ui';

// Define input/output schemas
const inputSchema = z.object({
  data: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    )
    .describe('Chart data points'),
  title: z.string().optional().describe('Chart title'),
});

const outputSchema = z.object({
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
  maxValue: z.number(),
});

// Infer types from schemas
type ChartInput = z.infer<typeof inputSchema>;
type ChartOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'react-chart',
  description: 'Generate a React bar chart visualization. Returns interactive chart with data points.',
  inputSchema,
  outputSchema,
  annotations: {
    title: 'Chart Visualization',
    readOnlyHint: true,
  },
  ui: {
    template: ChartCard,
    widgetDescription: 'Displays an interactive bar chart with color-coded data points.',
    displayMode: 'inline',
    widgetAccessible: true,
    servingMode: 'auto',
    resourceMode: 'cdn',
  },
})
export default class ReactChartTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: ChartInput): Promise<ChartOutput> {
    const maxValue = Math.max(...input.data.map((d) => d.value), 1);

    return {
      data: input.data,
      maxValue,
    };
  }
}
