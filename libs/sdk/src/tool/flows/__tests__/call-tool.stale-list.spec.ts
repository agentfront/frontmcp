/**
 * A session whose tool list changed is answered STALE_TOOL_LIST for a tool its list cannot show,
 * an internal one included, so the answer does not tell such a tool from one that does not exist.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

@Tool({ name: 'always_on', inputSchema: {} })
class AlwaysOnTool extends ToolContext {
  async execute() {
    return 'on';
  }
}

@Tool({ name: 'internal_helper', inputSchema: {}, visibility: 'internal' })
class InternalHelperTool extends ToolContext {
  async execute() {
    return 'internal';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [AlwaysOnTool, InternalHelperTool] })
class DeskApp {}

async function codeOfStaleCall(name: string): Promise<unknown> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'stale-list', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
  });
  const [scope] = instance.getScopes();
  try {
    scope.notifications.registerServer('session-1', {} as Parameters<typeof scope.notifications.registerServer>[1]);
    const ctx = { authInfo: { sessionId: 'session-1' } };
    await scope.runFlowForOutput('tools:list-tools', { request: { method: 'tools/list', params: {} }, ctx });
    scope.tools.notifyListChanged();

    const refusal = await scope
      .runFlowForOutput('tools:call-tool', { request: { method: 'tools/call', params: { name, arguments: {} } }, ctx })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    return (refusal as { code?: string } | undefined)?.code;
  } finally {
    await scope.dispose();
  }
}

describe('a call from a session whose tool list changed', () => {
  it('answers a tool that does not exist as a stale list', async () => {
    expect(await codeOfStaleCall('no_such_tool')).toBe('STALE_TOOL_LIST');
  });

  it('answers an internal tool the same way', async () => {
    expect(await codeOfStaleCall('internal_helper')).toBe('STALE_TOOL_LIST');
  });
});
