/**
 * An `outputSchema` literal ('string', 'number', 'boolean', 'date', 'image', ...) is checked like a Zod
 * schema: a value that is not what it declares fails the call with INVALID_OUTPUT. A primitive literal's
 * `structuredContent` is listed in tools/list, and a date is sent as ISO 8601.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { connect } from '../../../direct/connect';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { InvalidOutputError } from '../../../errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const RELEASE_DATE = new Date(Date.UTC(2026, 10, 9, 12, 30));
const PIXEL = { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' } as const;

function literalTool<Out>(name: string, outputSchema: 'string' | 'number' | 'boolean' | 'date' | 'image', value: Out) {
  @Tool({ name, inputSchema: {}, outputSchema })
  class LiteralTool extends ToolContext {
    async execute() {
      return value as never;
    }
  }
  return LiteralTool;
}

@Tool({ name: 'summarize_chart', inputSchema: {}, outputSchema: ['string', 'image'] })
class SummarizeChartTool extends ToolContext {
  async execute() {
    return ['Two bars', { id: 'chart-1' }] as never;
  }
}

@Tool({ name: 'release_date_zod', inputSchema: {}, outputSchema: z.date() })
class ReleaseDateZodTool extends ToolContext {
  async execute() {
    return RELEASE_DATE;
  }
}

@Tool({
  name: 'count_tickets_widget',
  inputSchema: {},
  outputSchema: 'number',
  ui: {
    template: (ctx: { helpers: { html: (parts: TemplateStringsArray) => unknown } }) =>
      ctx.helpers.html`<p>Open tickets</p>`,
  },
})
class CountTicketsWidgetTool extends ToolContext {
  async execute() {
    return 3;
  }
}

const literalTools = [
  literalTool('count_tickets', 'number', 3),
  literalTool('count_tickets_in_words', 'number', 'five'),
  literalTool('greet', 'string', 'Hello'),
  literalTool('greet_with_number', 'string', 42),
  literalTool('is_open', 'boolean', true),
  literalTool('is_open_in_words', 'boolean', 'yes'),
  literalTool('release_date', 'date', RELEASE_DATE),
  literalTool('release_date_in_words', 'date', 'next week'),
  literalTool('render_chart', 'image', PIXEL),
  literalTool('render_chart_by_id', 'image', { id: 'chart-1' }),
];

@App({
  id: 'desk',
  name: 'Desk',
  tools: [...literalTools, SummarizeChartTool, ReleaseDateZodTool, CountTicketsWidgetTool],
})
class DeskApp {}

const serverConfig = {
  info: { name: 'output-literals', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

describe('outputSchema literals', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterAll(async () => {
    await server.dispose();
  });

  describe('checking the value', () => {
    it.each([
      'count_tickets_in_words',
      'greet_with_number',
      'is_open_in_words',
      'release_date_in_words',
      'render_chart_by_id',
      'summarize_chart',
    ])('fails %s, whose value is not what its literal declares, with INVALID_OUTPUT', async (name) => {
      await expect(server.callTool(name, {})).rejects.toBeInstanceOf(InvalidOutputError);
    });

    it('sends a matching number as text and structuredContent', async () => {
      expect(await server.callTool('count_tickets', {})).toEqual({
        content: [{ type: 'text', text: '3' }],
        structuredContent: { content: 3 },
      });
    });

    it('sends a matching image as a content block', async () => {
      expect((await server.callTool('render_chart', {})).content).toEqual([PIXEL]);
    });
  });

  describe('dates', () => {
    it("sends a 'date' as ISO 8601, whatever the server's time zone", async () => {
      expect(await server.callTool('release_date', {})).toEqual({
        content: [{ type: 'text', text: '2026-11-09T12:30:00.000Z' }],
        structuredContent: { iso: '2026-11-09T12:30:00.000Z', timeInMilli: RELEASE_DATE.getTime() },
      });
    });

    it('sends a z.date() as ISO 8601 too', async () => {
      expect((await server.callTool('release_date_zod', {})).content).toEqual([
        { type: 'text', text: '2026-11-09T12:30:00.000Z' },
      ]);
    });
  });

  describe('tools/list', () => {
    async function listedOutputSchema(name: string) {
      const { tools } = await server.listTools();
      return tools.find((tool) => tool.name === name)?.outputSchema;
    }

    it.each([
      ['greet', 'string'],
      ['count_tickets', 'number'],
      ['is_open', 'boolean'],
    ])('lists the structuredContent of %s, a %s', async (name, type) => {
      expect(await listedOutputSchema(name)).toEqual({
        type: 'object',
        properties: { content: { type } },
        required: ['content'],
        additionalProperties: false,
      });
    });

    it("lists the structuredContent of a 'date'", async () => {
      expect(await listedOutputSchema('release_date')).toEqual({
        type: 'object',
        properties: { iso: { type: 'string', format: 'date-time' }, timeInMilli: { type: 'integer' } },
        required: ['iso', 'timeInMilli'],
        additionalProperties: false,
      });
    });

    it('lists no outputSchema for a media literal, which answers with content blocks only', async () => {
      expect(await listedOutputSchema('render_chart')).toBeUndefined();
    });

    it('answers with structuredContent an MCP client validates against the listed schema', async () => {
      const client = await connect(serverConfig, { clientInfo: { name: 'schema-probe', version: '1.0.0' } });
      try {
        await client.listTools();
        const counted = (await client.callTool('count_tickets', {})) as { structuredContent?: unknown };
        const dated = (await client.callTool('release_date', {})) as { structuredContent?: unknown };

        const widget = (await client.callTool('count_tickets_widget', {})) as { structuredContent?: unknown };

        expect([counted.structuredContent, dated.structuredContent, widget.structuredContent]).toEqual([
          { content: 3 },
          { iso: '2026-11-09T12:30:00.000Z', timeInMilli: RELEASE_DATE.getTime() },
          { content: 3 },
        ]);
      } finally {
        await client.close();
      }
    });
  });
});
