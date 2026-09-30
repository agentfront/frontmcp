/**
 * Issue #644 — `test.use()` is scoped to its `describe`, servers are stopped by the scope that
 * configured them, `describe.each` / `test.each` receive their rows, and `server.restart()`
 * reconnects the `mcp` client.
 *
 * The server and client are replaced with recorders: what is verified here is the fixture wiring.
 */
import { test } from '../test-fixture';

interface StartCall {
  env?: Record<string, string>;
  port?: number;
}

const recorded = {
  starts: [] as StartCall[],
  stops: 0,
  restarts: 0,
  reconnects: 0,
  clients: [] as Array<{ publicMode?: boolean }>,
};

jest.mock('../../server/test-server', () => {
  class FakeServer {
    constructor(private readonly port: number) {}
    get info() {
      return { baseUrl: `http://localhost:${this.port}`, port: this.port, pid: 4242 };
    }
    async stop() {
      recorded.stops++;
    }
    async restart() {
      recorded.restarts++;
    }
    getLogs() {
      return [];
    }
    clearLogs() {
      return undefined;
    }
  }
  return {
    TestServer: {
      start: jest.fn(async (options: StartCall) => {
        recorded.starts.push(options);
        return new FakeServer(options.port || 4000 + recorded.starts.length);
      }),
      connect: jest.fn(() => new FakeServer(1234)),
    },
  };
});

jest.mock('../../client/mcp-test-client', () => {
  class FakeClient {
    private connected = false;
    async connect() {
      this.connected = true;
    }
    async disconnect() {
      this.connected = false;
    }
    async reconnect() {
      recorded.reconnects++;
      this.connected = true;
    }
    isConnected() {
      return this.connected;
    }
  }
  return {
    McpTestClient: {
      create: (config: { publicMode?: boolean }) => ({
        build: () => {
          recorded.clients.push(config);
          return new FakeClient();
        },
        buildAndConnect: async () => {
          recorded.clients.push(config);
          const client = new FakeClient();
          await client.connect();
          return client;
        },
      }),
    },
  };
});

jest.mock('../../client/mcp-test-client.builder', () => ({
  McpTestClientBuilder: class {},
}));

const seen: string[] = [];

test.use({ server: './main.ts', port: 0, env: { SHARED: 'file' } });

test('file level test uses the file config only', async ({ server }) => {
  expect(recorded.starts).toHaveLength(1);
  expect(recorded.starts[0].env).toEqual({ SHARED: 'file' });
  expect(recorded.starts[0].port).toBe(0);
  expect(server.info.pid).toBe(4242);
  seen.push('file');
});

test.describe('block A', () => {
  test.use({ env: { BLOCK: 'A' } });

  test('gets its own server with merged env', async () => {
    expect(recorded.starts).toHaveLength(2);
    expect(recorded.starts[1].env).toEqual({ SHARED: 'file', BLOCK: 'A' });
    seen.push('A');
  });
});

test.describe('block B', () => {
  test.use({ env: { BLOCK: 'B' } });

  test('does not see the env of block A', async () => {
    // Block A's server was stopped by block A's afterAll, block B starts its own
    expect(recorded.stops).toBe(1);
    expect(recorded.starts).toHaveLength(3);
    expect(recorded.starts[2].env).toEqual({ SHARED: 'file', BLOCK: 'B' });
    seen.push('B');
  });

  test('reuses the block server for its next tests', async () => {
    expect(recorded.starts).toHaveLength(3);
  });
});

test.describe('a block without its own config', () => {
  test('shares the file server', async () => {
    // Block B stopped its server; the file server is still the first one
    expect(recorded.starts).toHaveLength(3);
    expect(recorded.stops).toBe(2);
  });
});

test.describe.each([
  ['one', 1],
  ['two', 2],
])('describe.each %s', (label, value) => {
  test('receives the row values', async () => {
    expect(typeof label).toBe('string');
    expect(typeof value).toBe('number');
    seen.push(`each:${label}:${value}`);
  });
});

test.each([
  ['x', 1],
  ['y', 2],
])('test.each %s', async ({ mcp }, label, value) => {
  expect(mcp.isConnected()).toBe(true);
  expect(['x', 'y']).toContain(label);
  expect([1, 2]).toContain(value);
  seen.push(`row:${label}:${value}`);
});

test('restart reconnects the mcp client and the clients created from the server fixture', async ({ mcp, server }) => {
  const before = recorded.reconnects;
  const extra = await server.createClient();
  await server.restart();
  expect(recorded.restarts).toBe(1);
  expect(recorded.reconnects).toBe(before + 2);
  expect(mcp.isConnected()).toBe(true);
  expect(extra.isConnected()).toBe(true);
});

test.describe('auth mode public keeps the client anonymous', () => {
  test.use({ auth: { mode: 'public' } });

  test('publicMode follows auth.mode', async () => {
    const last = recorded.clients[recorded.clients.length - 1];
    expect(last.publicMode).toBe(true);
    expect(recorded.starts[recorded.starts.length - 1].env).toEqual({
      SHARED: 'file',
      FRONTMCP_TEST_AUTH_MODE: 'public',
    });
  });
});

describe('after the run', () => {
  it('every block ran with the values it was registered with', () => {
    expect(seen).toEqual(expect.arrayContaining(['file', 'A', 'B', 'each:one:1', 'each:two:2', 'row:x:1', 'row:y:2']));
  });
});
