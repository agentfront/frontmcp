/**
 * Static Badge Tool - demonstrates servingMode: 'static'
 *
 * Static mode delivers pre-rendered HTML without server calls.
 * Supported by: OpenAI, ext-apps, Cursor, generic-mcp
 * NOT supported by: Claude, Continue, Cody (will skip UI)
 */
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  label: z.string().describe('Badge label text'),
  value: z.string().describe('Badge value text'),
  color: z.enum(['green', 'blue', 'red', 'yellow', 'gray']).optional().describe('Badge color'),
};

const outputSchema = z
  .object({
    label: z.string(),
    value: z.string(),
    color: z.string(),
    renderedAt: z.string(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'static-badge',
  description: 'Generate a static badge widget. Uses static serving mode (pre-rendered HTML).',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'static',
    displayMode: 'inline',
    widgetDescription: 'Displays a pre-rendered badge that does not make additional server calls.',
    // Handlebars string template - processed at runtime with actual data
    // Handlebars automatically escapes HTML in {{...}} expressions
    template: `
<div class="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium
  {{#if (eq output.color 'green')}}bg-green-100 text-green-800 border-green-200{{/if}}
  {{#if (eq output.color 'blue')}}bg-blue-100 text-blue-800 border-blue-200{{/if}}
  {{#if (eq output.color 'red')}}bg-red-100 text-red-800 border-red-200{{/if}}
  {{#if (eq output.color 'yellow')}}bg-yellow-100 text-yellow-800 border-yellow-200{{/if}}
  {{#unless output.color}}bg-gray-100 text-gray-800 border-gray-200{{/unless}}
  {{#if (eq output.color 'gray')}}bg-gray-100 text-gray-800 border-gray-200{{/if}}">
  <span class="font-semibold">{{output.label}}:</span>
  <span class="ml-1">{{output.value}}</span>
</div>
    `.trim(),
  },
})
export default class StaticBadgeTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      label: input.label,
      value: input.value,
      color: input.color || 'gray',
      renderedAt: new Date().toISOString(),
    };
  }
}
