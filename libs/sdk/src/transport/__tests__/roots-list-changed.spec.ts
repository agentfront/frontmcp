/**
 * A session whose client declares `roots`: the server keeps the roots it read per session, and reads them again once
 * the client says they changed with `notifications/roots/list_changed`. Checked in an in-memory session
 * (`createInMemoryServer()`, what `connect()` runs on) and in a session of the Node HTTP server.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { ListRootsRequestSchema, type Root } from '@frontmcp/protocol';
import { Client, SSEClientTransport } from '@frontmcp/protocol/client';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createInMemoryServer } from '../in-memory-server';

/** Answers the roots the server holds for the caller's session. */
@Tool({ name: 'read_roots', inputSchema: {} })
class ReadRootsTool extends ToolContext {
  /** Reads the session's roots as server code does, through the cache of the notification service. */
  async execute() {
    const roots = await this.scope.notifications.listRoots(this.authInfo.sessionId ?? '');
    return { uris: roots.map((root) => root.uri) };
  }
}

@App({ id: 'workspace', name: 'Workspace', tools: [ReadRootsTool] })
class WorkspaceApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'roots-list-changed', version: '1.0.0' },
  apps: [WorkspaceApp],
  logging: { level: LogLevel.Off },
};

interface RootsClient {
  client: Client;
  /** Replace the client's roots and tell the server they changed. */
  changeRoots(uris: string[]): Promise<void>;
  /** The roots the server answers for this session. */
  readRoots(): Promise<string[]>;
}

/** A client that declares `roots`, answers `roots/list` with its current ones, and says when they change. */
function rootsClient(initialUris: string[]): RootsClient {
  let roots: Root[] = initialUris.map((uri) => ({ uri }));
  const client = new Client(
    { name: 'roots-client', version: '1.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({ roots }));
  return {
    client,
    changeRoots: async (uris) => {
      roots = uris.map((uri) => ({ uri }));
      await client.sendRootsListChanged();
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    readRoots: async () => {
      const answer = await client.callTool({ name: 'read_roots', arguments: {} });
      return (answer.structuredContent as { uris: string[] }).uris;
    },
  };
}

/** Reads the roots, changes them, and reads them again. */
async function rootsBeforeAndAfterChange(session: RootsClient): Promise<string[][]> {
  const before = await session.readRoots();
  await session.changeRoots(['file:///workspace/second']);
  return [before, await session.readRoots()];
}

describe('notifications/roots/list_changed', () => {
  const FIRST_THEN_SECOND = [['file:///workspace/first'], ['file:///workspace/second']];
  const savedSessionSecret = process.env['MCP_SESSION_SECRET'];
  const cleanups: Array<() => Promise<unknown>> = [];

  beforeAll(() => {
    process.env['MCP_SESSION_SECRET'] = 'roots-list-changed-spec-secret';
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  afterAll(() => {
    if (savedSessionSecret === undefined) delete process.env['MCP_SESSION_SECRET'];
    else process.env['MCP_SESSION_SECRET'] = savedSessionSecret;
  });

  it('makes the server of an in-memory session read the roots again', async () => {
    const instance = await FrontMcpInstance.createForGraph(config);
    const scope = instance.getScopes()[0] as Scope;
    const server = await createInMemoryServer(scope);
    const session = rootsClient(['file:///workspace/first']);
    cleanups.push(
      () => session.client.close(),
      server.close,
      () => scope.dispose(),
    );
    await session.client.connect(server.clientTransport);

    expect(await rootsBeforeAndAfterChange(session)).toEqual(FIRST_THEN_SECOND);
  });

  it('makes the server of an HTTP session read the roots again', async () => {
    const handler = (await FrontMcpInstance.createHandler({ ...config, http: { entryPath: '/mcp' } })) as never;
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const session = rootsClient(['file:///workspace/first']);
    cleanups.push(
      () => session.client.close(),
      async () => server.closeAllConnections(),
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    await session.client.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${port}/mcp/sse`)));

    expect(await rootsBeforeAndAfterChange(session)).toEqual(FIRST_THEN_SECOND);
  });
});
