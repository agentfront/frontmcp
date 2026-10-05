import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { App, LogLevel, Tool, tool, ToolContext } from '../../index';
import { NotificationService } from '../../notification';

@Tool({ name: 'class_report', inputSchema: { id: z.string() }, outputSchema: { progressSent: z.boolean() } })
class ClassReportTool extends ToolContext {
  async execute(input: { id: string }) {
    await this.notify(`saving ${input.id}`);
    this.notifyResourceUpdated(`notes://${input.id}`);
    this.notifyResourceListChanged();
    return { progressSent: await this.progress(1, 2, 'first step') };
  }
}

const FunctionReportTool = tool({
  name: 'function_report',
  inputSchema: { id: z.string() },
  outputSchema: { progressSent: z.boolean() },
})(async (input, ctx) => {
  await ctx.notify(`saving ${input.id}`);
  ctx.notifyResourceUpdated(`notes://${input.id}`);
  ctx.notifyResourceListChanged();
  return { progressSent: await ctx.progress(1, 2, 'first step') };
});

@App({ name: 'Reports', tools: [ClassReportTool, FunctionReportTool] })
class ReportsApp {}

describe.each(['class_report', 'function_report'])('the %s tool', (toolName) => {
  let client: DirectClient;
  let logMessages: jest.SpyInstance;
  let resourceUpdates: jest.SpyInstance;
  let broadcasts: jest.SpyInstance;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'tool-reports', version: '1.0.0' },
      apps: [ReportsApp],
      logging: { level: LogLevel.Off },
    });
  });

  beforeEach(() => {
    logMessages = jest.spyOn(NotificationService.prototype, 'sendLogMessageToSession');
    resourceUpdates = jest.spyOn(NotificationService.prototype, 'notifyResourceUpdated');
    broadcasts = jest.spyOn(NotificationService.prototype, 'broadcastNotification');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await client.close();
  });

  it("sends its notify() calls as log messages to the caller's session", async () => {
    await client.callTool(toolName, { id: 'n1' });

    expect(logMessages.mock.calls).toEqual([[expect.any(String), 'info', toolName, { message: 'saving n1' }]]);
  });

  it('announces the resource it changed and the resource list change', async () => {
    await client.callTool(toolName, { id: 'n1' });

    expect(resourceUpdates.mock.calls).toEqual([['notes://n1']]);
    expect(broadcasts).toHaveBeenCalledWith('notifications/resources/list_changed');
  });

  it('reports progress as not sent when the request carries no progress token', async () => {
    const result = await client.callTool(toolName, { id: 'n1' });

    expect(result).toMatchObject({ structuredContent: { progressSent: false } });
  });
});
