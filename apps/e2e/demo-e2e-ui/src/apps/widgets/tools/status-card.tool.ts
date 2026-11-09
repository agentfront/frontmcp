/**
 * Status Card Tool - a React component reference rendered on the server (`ui.uiType: 'react'`).
 */
import React from 'react';

import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  service: z.string().describe('Service name'),
};

const outputSchema = z.object({ service: z.string(), state: z.enum(['up', 'down']) });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

function StatusCard({ output, loading }: { output: Output | null; loading: boolean }) {
  if (loading || !output) return React.createElement('p', { className: 'status-card' }, 'Checking...');
  return React.createElement(
    'div',
    { className: `status-card status-${output.state}` },
    React.createElement('strong', null, output.service),
    ` is ${output.state}`,
  );
}

@Tool({
  name: 'status-card',
  description: 'Show the status of a service',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'inline',
    uiType: 'react',
    template: StatusCard,
  },
})
export default class StatusCardTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { service: input.service, state: 'up' };
  }
}
