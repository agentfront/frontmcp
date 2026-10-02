import 'reflect-metadata';

import { LogLevel, tool } from '../../../common';
import { InvalidInputError } from '../../../errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import type { Scope } from '../../../scope/scope.instance';

/**
 * Past 40 tools `tools/list` pages its answer, with an opaque cursor (base64 JSON `{ offset }`).
 * A browser build runs this flow too, where Node's `Buffer` does not exist, so the cursor must be
 * encoded and decoded without it.
 */

const TOOL_COUNT = 45;

const tools = Array.from({ length: TOOL_COUNT }, (_, i) =>
  tool({ name: `tool_${String(i).padStart(2, '0')}`, inputSchema: {} })(() => ({ index: i })),
);

const serverConfig = {
  info: { name: 'tools-list-pagination', version: '1.0.0' },
  tools,
  logging: { level: LogLevel.Off },
};

describe('tools/list pagination', () => {
  let scope: Scope;

  beforeAll(async () => {
    const { buildConfig } = await import('../../../direct/create');
    [scope] = (await FrontMcpInstance.createForGraph(buildConfig(serverConfig))).getScopes() as Scope[];
  });

  afterAll(async () => {
    await scope.shutdown();
  });

  function listPage(cursor?: string) {
    return scope.runFlowForOutput('tools:list-tools', {
      request: { method: 'tools/list', params: cursor === undefined ? {} : { cursor } },
      ctx: { authInfo: { sessionId: 'pagination' } },
    });
  }

  async function listAll(): Promise<{ names: string[]; cursors: string[] }> {
    const names: string[] = [];
    const cursors: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPage(cursor);
      names.push(...page.tools.map((entry) => entry.name));
      cursor = page.nextCursor;
      if (cursor) cursors.push(cursor);
    } while (cursor);
    return { names, cursors };
  }

  it('pages past 40 tools with a base64 JSON offset cursor', async () => {
    const { names, cursors } = await listAll();

    expect(names).toHaveLength(TOOL_COUNT);
    expect(new Set(names).size).toBe(TOOL_COUNT);
    expect(cursors).toEqual([Buffer.from(JSON.stringify({ offset: 40 })).toString('base64')]);
  });

  it('pages the same way without Node Buffer, as in a browser', async () => {
    const globals = globalThis as { Buffer?: typeof Buffer };
    const nodeBuffer = globals.Buffer;
    delete globals.Buffer;
    let result: { names: string[]; cursors: string[] };
    try {
      result = await listAll();
    } finally {
      globals.Buffer = nodeBuffer;
    }

    expect(result.names).toHaveLength(TOOL_COUNT);
    expect(result.cursors).toEqual([Buffer.from(JSON.stringify({ offset: 40 })).toString('base64')]);
  });

  it('refuses a cursor that is not base64 JSON', async () => {
    await expect(listPage('not a cursor')).rejects.toThrow(InvalidInputError);
  });

  it('refuses a cursor whose offset is not a non-negative integer', async () => {
    const cursor = Buffer.from(JSON.stringify({ offset: -1 })).toString('base64');

    await expect(listPage(cursor)).rejects.toThrow(/non-negative integer/);
  });
});
