/**
 * Issue #680 — `test.beforeEach(async ({ mcp }) => …)` used to be handed to Jest as is: Jest read the
 * destructured parameter as a `done` callback and waited for it until the test timed out. Hooks that
 * take a parameter now receive the test's fixtures, Playwright-style; hooks without one stay plain
 * Jest hooks. Also: an `env` object passed to `test.use()` is read when the server starts, so values a
 * `beforeAll` fills in reach it.
 *
 * The server and client are replaced with recorders: what is verified here is the fixture wiring.
 */
import { test } from '../test-fixture';

const events: string[] = [];
const starts: Array<Record<string, string> | undefined> = [];
let clientSeq = 0;

jest.mock('../../server/test-server', () => {
  class FakeServer {
    get info() {
      return { baseUrl: 'http://localhost:4000', port: 4000, pid: 1 };
    }
    async stop() {
      return undefined;
    }
    async restart() {
      return undefined;
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
      start: jest.fn(async (options: { env?: Record<string, string> }) => {
        starts.push(options.env);
        return new FakeServer();
      }),
      connect: jest.fn(() => new FakeServer()),
    },
  };
});

jest.mock('../../client/mcp-test-client', () => {
  class FakeClient {
    readonly id = ++clientSeq;
    private connected = false;
    async connect() {
      this.connected = true;
    }
    async disconnect() {
      events.push(`disconnect:${this.id}`);
      this.connected = false;
    }
    isConnected() {
      return this.connected;
    }
  }
  return {
    McpTestClient: {
      create: () => ({ build: () => new FakeClient() }),
    },
  };
});

jest.mock('../../client/mcp-test-client.builder', () => ({
  McpTestClientBuilder: class {},
}));

type FakeMcp = { id: number; isConnected(): boolean };
const idOf = (mcp: unknown): number => (mcp as FakeMcp).id;

// Filled in by beforeAll, after `test.use()` captured the object
const lateEnv: Record<string, string> = {};
beforeAll(() => {
  lateEnv['LATE_PORT'] = '5555';
});

test.use({ server: './main.ts', env: lateEnv });

let plainHookRuns = 0;
test.beforeEach(() => {
  plainHookRuns++;
});

test.beforeEach(async ({ mcp }) => {
  events.push(`outer-before:${idOf(mcp)}`);
});

test.afterEach(async ({ mcp }) => {
  // Fixtures are still connected in afterEach: teardown comes after the last hook
  events.push(`outer-after:${idOf(mcp)}:${(mcp as FakeMcp).isConnected()}`);
});

test('env objects passed to test.use() are read when the server starts', async () => {
  expect(starts[0]).toEqual({ LATE_PORT: '5555' });
});

test('a beforeEach with fixtures gets the same mcp client as the test, and does not hang', async ({ mcp }) => {
  expect(events).toContain(`outer-before:${idOf(mcp)}`);
  expect(plainHookRuns).toBeGreaterThan(0);
});

test.describe('nested block', () => {
  test.beforeEach(({ mcp }) => {
    events.push(`inner-before:${idOf(mcp)}`);
  });
  test.afterEach(({ mcp }) => {
    events.push(`inner-after:${idOf(mcp)}`);
  });

  test('outer hooks run first before the test, inner hooks first after it', async ({ mcp }) => {
    const id = idOf(mcp);
    const mine = events.filter((e) => e.endsWith(`:${id}`));
    expect(mine).toEqual([`outer-before:${id}`, `inner-before:${id}`]);
    events.push(`test:${id}`);
  });
});

test.describe('after the nested block', () => {
  test('its hooks and teardown ran in Playwright order', async () => {
    const testEvent = events.find((e) => e.startsWith('test:'));
    expect(testEvent).toBeDefined();
    const id = Number(testEvent?.split(':')[1]);
    const mine = events.filter((e) => e.split(':')[1] === String(id));
    expect(mine).toEqual([
      `outer-before:${id}`,
      `inner-before:${id}`,
      `test:${id}`,
      `inner-after:${id}`,
      `outer-after:${id}:true`,
      `disconnect:${id}`,
    ]);
  });
});
