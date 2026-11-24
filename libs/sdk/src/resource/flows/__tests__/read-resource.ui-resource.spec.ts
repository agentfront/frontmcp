import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, ResourceContext, ResourceTemplate, Tool, ToolContext } from '../../../common';
import { connect } from '../../../direct';
import type { DirectClient } from '../../../direct/client.types';
import { MCP_ERROR_CODES } from '../../../errors';

const PAGE_MIME_TYPE = 'text/html;profile=mcp-app';

@ResourceTemplate({ name: 'canvas', uriTemplate: 'ui://canvas/{id}', mimeType: PAGE_MIME_TYPE })
class CanvasPage extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    return { contents: [{ uri, mimeType: PAGE_MIME_TYPE, text: `<p>canvas ${params.id}</p>` }] };
  }
}

@ResourceTemplate({ name: 'closed-canvas', uriTemplate: 'ui://closed/{id}', mimeType: PAGE_MIME_TYPE, enabled: false })
class ClosedCanvasPage extends ResourceContext<{ id: string }> {
  async execute(uri: string) {
    return { contents: [{ uri, mimeType: PAGE_MIME_TYPE, text: '<p>closed</p>' }] };
  }
}

@Tool({ name: 'forecast', inputSchema: { city: z.string() }, ui: { template: '<div id="forecast-widget"></div>' } })
class ForecastTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city };
  }
}

@Tool({
  name: 'closed_card',
  inputSchema: {},
  ui: { template: '<div id="closed-card"></div>', resourceUri: 'ui://closed/card' },
})
class ClosedCardTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({
  id: 'canvas-app',
  name: 'Canvas',
  tools: [ForecastTool, ClosedCardTool],
  resources: [CanvasPage, ClosedCanvasPage],
})
class CanvasApp {}

async function errorCodeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
}

async function errorOf(promise: Promise<unknown>): Promise<{ code?: unknown; message?: unknown } | 'accepted'> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    return error as { code?: unknown; message?: unknown };
  }
}

describe('resources/read of a ui:// URI that is not a tool widget', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'ui-resource-read', version: '1.0.0' },
      apps: [CanvasApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('reads a ui:// resource template from the resource registry', async () => {
    const result = await client.readResource('ui://canvas/abc');

    expect(result.contents).toEqual([{ uri: 'ui://canvas/abc', mimeType: PAGE_MIME_TYPE, text: '<p>canvas abc</p>' }]);
  });

  it("still serves a tool's widget from its ui:// URI", async () => {
    const result = await client.readResource('ui://widget/forecast.html');

    expect(result.contents[0]).toEqual(expect.objectContaining({ uri: 'ui://widget/forecast.html' }));
  });

  it.each(['ui://nothing/here', 'ui://widget/no-such-tool.html'])(
    'answers a read of and a subscription to %s with resource not found',
    async (uri) => {
      expect(await errorCodeOf(client.readResource(uri))).toBe(MCP_ERROR_CODES.RESOURCE_NOT_FOUND);
      expect(await errorCodeOf(client.subscribeResource(uri))).toBe(MCP_ERROR_CODES.RESOURCE_NOT_FOUND);
    },
  );

  it('applies the checks of the resource it finds, as for any other scheme', async () => {
    // The direct client answers with the protocol's McpError, which keeps the code and message, not the SDK's class
    const turnedOff = { code: MCP_ERROR_CODES.FORBIDDEN, message: expect.stringContaining('is turned off') };

    expect(await errorOf(client.readResource('ui://closed/abc'))).toEqual(expect.objectContaining(turnedOff));
    expect(await errorOf(client.subscribeResource('ui://closed/abc'))).toEqual(expect.objectContaining(turnedOff));
  });

  it("reads and subscribes to a tool's custom ui.resourceUri as its widget, before a template that also matches it", async () => {
    const result = await client.readResource('ui://closed/card');

    expect(result.contents[0]).toEqual(expect.objectContaining({ uri: 'ui://closed/card' }));
    expect(await errorCodeOf(client.subscribeResource('ui://closed/card'))).toBe('accepted');
  });

  it('subscribes to a ui:// resource template and to a tool widget', async () => {
    expect(await errorCodeOf(client.subscribeResource('ui://canvas/abc'))).toBe('accepted');
    expect(await errorCodeOf(client.subscribeResource('ui://widget/forecast.html'))).toBe('accepted');
  });
});
