/**
 * A session whose client declares `roots`: the server keeps the roots it read per session, and reads them again once
 * the client says they changed with `notifications/roots/list_changed`. Checked in an in-memory session
 * (`createInMemoryServer()`, what `connect()` runs on), and on the server a local adapter connects for an HTTP session,
 * over a transport the spec holds.
 */
import 'reflect-metadata';

import { ListRootsRequestSchema, type JSONRPCMessage, type Root, type Transport } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { LocalTransportAdapter } from '../adapters/transport.local.adapter';
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

/** Stands in for the wire of an HTTP session: answers the server's `roots/list`, and delivers what the client sends. */
class SessionWire {
  onmessage?: Transport['onmessage'];

  /** Takes the root this session's client answers with. */
  constructor(private readonly rootUri: string) {}

  /** Nothing to start: the spec delivers the client's messages itself. */
  async start(): Promise<void> {
    return undefined;
  }

  /** Answers a `roots/list` request of the server as the client would. */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!('method' in message) || message.method !== 'roots/list' || !('id' in message)) return;
    this.onmessage?.({ jsonrpc: '2.0', id: message.id, result: { roots: [{ uri: this.rootUri }] } });
  }

  /** Nothing to close. */
  async close(): Promise<void> {
    return undefined;
  }
}

/** Connects the server of a local adapter for `sessionId` to a wire, without the adapter's own transport. */
async function connectLocalAdapter(scope: Scope, sessionId: string, rootUri: string): Promise<SessionWire> {
  const wire = new SessionWire(rootUri);
  const adapter = Object.create(LocalTransportAdapter.prototype) as LocalTransportAdapter<never>;
  Object.assign(adapter, { scope, key: { sessionId }, logger: scope.logger, transport: wire });
  await adapter.connectServer();
  scope.notifications.setClientCapabilities(sessionId, { roots: { listChanged: true } });
  return wire;
}

describe('notifications/roots/list_changed', () => {
  const FIRST_THEN_SECOND = [['file:///workspace/first'], ['file:///workspace/second']];
  const cleanups: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
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

  it('clears the roots a local adapter holds for its own session, and for no other session', async () => {
    const instance = await FrontMcpInstance.createForGraph(config);
    const scope = instance.getScopes()[0] as Scope;
    cleanups.push(() => scope.dispose());
    const firstWire = await connectLocalAdapter(scope, 'session-one', 'file:///workspace/one');
    await connectLocalAdapter(scope, 'session-two', 'file:///workspace/two');
    await scope.notifications.listRoots('session-one');
    await scope.notifications.listRoots('session-two');
    expect(scope.notifications.getCachedRoots('session-one')).toEqual([{ uri: 'file:///workspace/one' }]);

    firstWire.onmessage?.({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(scope.notifications.getCachedRoots('session-one')).toBeUndefined();
    expect(scope.notifications.getCachedRoots('session-two')).toEqual([{ uri: 'file:///workspace/two' }]);
  });
});
