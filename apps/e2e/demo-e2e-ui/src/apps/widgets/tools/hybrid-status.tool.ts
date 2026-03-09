/**
 * Hybrid Status Tool - demonstrates servingMode: 'hybrid'
 *
 * Hybrid mode delivers a pre-rendered shell with dynamic data slots.
 * Supported by: OpenAI, ext-apps, Cursor
 * NOT supported by: Claude, Continue, Cody, generic-mcp (will skip UI)
 */
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  serviceName: z.string().describe('Name of the service'),
  status: z.enum(['healthy', 'degraded', 'down']).describe('Service status'),
  uptime: z.number().optional().describe('Uptime percentage'),
  lastCheck: z.string().optional().describe('Last check timestamp'),
};

const outputSchema = z
  .object({
    serviceName: z.string(),
    status: z.string(),
    statusColor: z.string(),
    uptime: z.number(),
    lastCheck: z.string(),
    isHealthy: z.boolean(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'hybrid-status',
  description: 'Generate a hybrid status widget with pre-rendered shell and dynamic data.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'hybrid',
    displayMode: 'inline',
    widgetDescription: 'Displays a service status card with hybrid rendering.',
    template: (ctx) => {
      const { serviceName, status, statusColor, uptime, lastCheck, isHealthy } = ctx.output as unknown as Output;
      const escapeHtml = ctx.helpers.escapeHtml;

      const statusBgColors: Record<string, string> = {
        green: 'bg-green-500',
        yellow: 'bg-yellow-500',
        red: 'bg-red-500',
      };

      const bgColor = statusBgColors[statusColor] || 'bg-gray-500';

      return `
<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold text-gray-900">${escapeHtml(serviceName)}</h3>
    <span class="inline-flex items-center rounded-full ${bgColor} px-2.5 py-0.5 text-xs font-medium text-white">
      ${escapeHtml(status.toUpperCase())}
    </span>
  </div>
  <div class="mt-3 grid grid-cols-2 gap-4 text-sm">
    <div>
      <span class="text-gray-500">Uptime</span>
      <p class="font-medium text-gray-900">${uptime.toFixed(2)}%</p>
    </div>
    <div>
      <span class="text-gray-500">Last Check</span>
      <p class="font-medium text-gray-900">${escapeHtml(lastCheck)}</p>
    </div>
  </div>
  ${
    !isHealthy
      ? `
  <div class="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">
    ⚠️ Service requires attention
  </div>
  `
      : ''
  }
</div>
      `.trim();
    },
  },
})
export default class HybridStatusTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const statusColors: Record<string, string> = {
      healthy: 'green',
      degraded: 'yellow',
      down: 'red',
    };

    return {
      serviceName: input.serviceName,
      status: input.status,
      statusColor: statusColors[input.status] || 'gray',
      uptime: input.uptime ?? 99.9,
      lastCheck: input.lastCheck || new Date().toISOString(),
      isHealthy: input.status === 'healthy',
    };
  }
}
