import 'reflect-metadata';

import {
  App,
  FlowControl,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type FrontMcpLogger,
  type ScopeEntry,
} from '@frontmcp/sdk';

import { isWebMcpSupported, toWebMcpToolName, WebMcpBridge } from '../webmcp.bridge';
import { webMcpPluginOptionsSchema, type WebMcpPluginOptionsInput } from '../webmcp.options';
import WebMcpPlugin from '../webmcp.plugin';
import type { ModelContext, ModelContextTool } from '../webmcp.types';
import { FakeModelContext, settle } from './helpers/fake-model-context';

@Tool({ name: 'ping', description: 'Ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'bridge-app', name: 'Bridge', tools: [PingTool] })
class BridgeApp {}

const serverConfig = {
  info: { name: 'webmcp-bridge', version: '1.0.0' },
  apps: [BridgeApp],
  logging: { level: LogLevel.Off },
};

function mockLogger() {
  const logger = {
    debug: jest.fn(),
    verbose: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

/** A scope whose logger is observable, built from a real server. */
async function createScope(): Promise<{ scope: ScopeEntry; logger: ReturnType<typeof mockLogger> }> {
  const [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes() as ScopeEntry[];
  const logger = mockLogger();
  jest.spyOn(scope.logger, 'child').mockReturnValue(logger as unknown as FrontMcpLogger);
  return { scope, logger };
}

function bridgeFor(scope: ScopeEntry, options: WebMcpPluginOptionsInput = {}): WebMcpBridge {
  return new WebMcpBridge(scope, webMcpPluginOptionsSchema.parse(options));
}

/** Installs `document` on the global object for the duration of a test. */
function withDocument(document: unknown): () => void {
  const globals = globalThis as { document?: unknown };
  const had = 'document' in globals;
  const previous = globals.document;
  globals.document = document;
  return () => {
    if (had) globals.document = previous;
    else delete globals.document;
  };
}

describe('WebMcpBridge', () => {
  let scope: ScopeEntry;
  let logger: ReturnType<typeof mockLogger>;

  beforeEach(async () => {
    ({ scope, logger } = await createScope());
  });

  describe('finding the ModelContext', () => {
    it('does nothing without one, and says so at debug level', async () => {
      const bridge = bridgeFor(scope);

      bridge.start();
      bridge.refresh();
      await bridge.whenIdle();

      expect(bridge.registeredToolNames).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('WebMCP is not available'));
    });

    it('uses document.modelContext when no modelContext option is given', async () => {
      const modelContext = new FakeModelContext();
      const restore = withDocument({ modelContext });
      try {
        const bridge = bridgeFor(scope);
        bridge.start();
        await bridge.whenIdle();

        expect(modelContext.names()).toEqual(['ping']);
        expect(bridge.registeredToolNames).toEqual(['ping']);
        bridge.stop();
      } finally {
        restore();
      }
    });
  });

  describe('isWebMcpSupported()', () => {
    it.each([
      ['no document', false, undefined],
      ['a document without modelContext', false, {}],
      ['a modelContext without registerTool', false, { modelContext: {} }],
      ['a null modelContext', false, { modelContext: null }],
      ['document.modelContext.registerTool', true, { modelContext: { registerTool: () => Promise.resolve() } }],
    ])('with %s: %s', (_label, supported, document) => {
      const restore = withDocument(document);
      try {
        expect(isWebMcpSupported()).toBe(supported);
      } finally {
        restore();
      }
    });
  });

  describe('toWebMcpToolName()', () => {
    it.each([
      ['plain_name-1.0', 'plain_name-1.0'],
      ['app:tool', 'app_tool'],
      ['with space/and slash', 'with_space_and_slash'],
      ['', '_'],
      ['x'.repeat(200), 'x'.repeat(128)],
    ])('%s → %s', (name, expected) => {
      expect(toWebMcpToolName(name)).toBe(expected);
    });
  });

  it('keeps deduplicated names within 128 characters', async () => {
    const modelContext = new FakeModelContext();
    const longName = 'n'.repeat(130);
    const runFlow = scope.runFlowForOutput.bind(scope);
    jest.spyOn(scope, 'runFlowForOutput').mockImplementation((async (name: string, input: never) => {
      if (name !== 'tools:list-tools') return runFlow(name as never, input);
      const tool = (suffix: string) => ({ name: `${longName}${suffix}`, inputSchema: { type: 'object' } });
      return { tools: [tool('a'), tool('b'), tool('c')] };
    }) as never);
    const bridge = bridgeFor(scope, { modelContext });

    bridge.start();
    await bridge.whenIdle();

    expect(modelContext.names()).toEqual(['n'.repeat(126) + '_2', 'n'.repeat(126) + '_3', 'n'.repeat(128)]);
    bridge.stop();
  });

  describe('syncing', () => {
    it('lists the tools once for a burst of refreshes', async () => {
      const modelContext = new FakeModelContext();
      const runFlow = jest.spyOn(scope, 'runFlowForOutput');
      const bridge = bridgeFor(scope, { modelContext });
      bridge.start();
      await bridge.whenIdle();
      runFlow.mockClear();

      for (let i = 0; i < 10; i++) bridge.refresh();
      await bridge.whenIdle();

      expect(runFlow.mock.calls.filter(([name]) => name === 'tools:list-tools')).toHaveLength(1);
      bridge.stop();
    });

    it('syncs again when a change arrives during a sync', async () => {
      const modelContext = new FakeModelContext();
      const bridge = bridgeFor(scope, { modelContext });
      const runFlow = jest.spyOn(scope, 'runFlowForOutput');
      bridge.start();
      await Promise.resolve();
      await Promise.resolve();

      bridge.refresh(); // the first sync is already running
      await bridge.whenIdle();

      expect(runFlow.mock.calls.filter(([name]) => name === 'tools:list-tools')).toHaveLength(2);
      bridge.stop();
    });

    it('logs a failed sync and recovers on the next change', async () => {
      const modelContext = new FakeModelContext();
      const runFlow = scope.runFlowForOutput.bind(scope);
      const spy = jest.spyOn(scope, 'runFlowForOutput').mockRejectedValueOnce(new Error('listing failed'));
      const bridge = bridgeFor(scope, { modelContext });

      bridge.start();
      await bridge.whenIdle();
      expect(logger.warn).toHaveBeenCalledWith('WebMCP sync failed: listing failed');
      expect(modelContext.names()).toEqual([]);

      spy.mockImplementation(runFlow as never);
      bridge.refresh();
      await bridge.whenIdle();
      expect(modelContext.names()).toEqual(['ping']);
      bridge.stop();
    });

    it('takes a listing that answers through FlowControl.respond as output', async () => {
      const modelContext = new FakeModelContext();
      jest.spyOn(scope, 'runFlowForOutput').mockImplementation((() => {
        throw new FlowControl('respond', { tools: [{ name: 'responded', inputSchema: { type: 'object' } }] });
      }) as never);
      const bridge = bridgeFor(scope, { modelContext });

      bridge.start();
      await bridge.whenIdle();

      expect(modelContext.names()).toEqual(['responded']);
      bridge.stop();
    });

    it('reports a refused registration once, then quietly retries it', async () => {
      const modelContext = new FakeModelContext();
      modelContext.refuse.add('ping');
      const bridge = bridgeFor(scope, { modelContext });

      bridge.start();
      await bridge.whenIdle();
      bridge.refresh();
      await bridge.whenIdle();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('WebMCP refused tool "ping"'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('WebMCP refused tool "ping"'));

      modelContext.refuse.delete('ping');
      bridge.refresh();
      await bridge.whenIdle();
      expect(modelContext.names()).toEqual(['ping']);
      bridge.stop();
    });

    it('reports a non-Error refusal too', async () => {
      const modelContext: ModelContext = { registerTool: () => Promise.reject('policy denied') };
      const bridge = bridgeFor(scope, { modelContext });

      bridge.start();
      await bridge.whenIdle();

      expect(logger.warn).toHaveBeenCalledWith('WebMCP refused tool "ping": policy denied');
      bridge.stop();
    });
  });

  describe('stopping', () => {
    it('is idempotent, and a stopped bridge does not start again', async () => {
      const modelContext = new FakeModelContext();
      const bridge = bridgeFor(scope, { modelContext });
      bridge.start();
      bridge.start();
      await bridge.whenIdle();

      bridge.stop();
      bridge.stop();
      bridge.start();
      bridge.refresh();
      await bridge.whenIdle();

      expect(modelContext.names()).toEqual([]);
      expect(modelContext.unregistered).toEqual(['ping']);
    });

    it('aborts a registration the ModelContext is still answering', async () => {
      let signal: AbortSignal | undefined;
      let answer: () => void = () => undefined;
      const modelContext: ModelContext = {
        registerTool: (_tool, options) => {
          signal = options?.signal;
          return new Promise<void>((resolve) => (answer = resolve));
        },
      };
      const bridge = bridgeFor(scope, { modelContext });
      bridge.start();
      await settle();

      bridge.stop();
      answer();
      await bridge.whenIdle();

      expect(signal?.aborted).toBe(true);
    });
  });

  describe('a call', () => {
    async function registeredPing(): Promise<{ bridge: WebMcpBridge; ping: ModelContextTool }> {
      const modelContext = new FakeModelContext();
      const bridge = bridgeFor(scope, { modelContext });
      bridge.start();
      await bridge.whenIdle();
      return { bridge, ping: modelContext.tool('ping') };
    }

    it('runs without a signal when the caller gives none', async () => {
      const { bridge, ping } = await registeredPing();

      const result = await ping.execute({}, {} as never);

      expect(JSON.stringify(result)).toContain('pong');
      bridge.stop();
    });

    it('takes a call that answers through FlowControl.respond as output', async () => {
      const { bridge, ping } = await registeredPing();
      jest.spyOn(scope, 'runFlowForOutput').mockImplementation((() => {
        throw new FlowControl('respond', { content: [{ type: 'text', text: 'responded' }] });
      }) as never);

      expect(await ping.execute({}, { signal: new AbortController().signal })).toEqual({
        content: [{ type: 'text', text: 'responded' }],
      });
      bridge.stop();
    });

    it('returns empty content for a result without any', async () => {
      const { bridge, ping } = await registeredPing();
      jest.spyOn(scope, 'runFlowForOutput').mockResolvedValue({} as never);

      expect(await ping.execute({}, { signal: new AbortController().signal })).toEqual({ content: [] });
      bridge.stop();
    });

    it('rejects with the public message of a server error, not its internals', async () => {
      const { bridge, ping } = await registeredPing();
      const serverError = Object.assign(new Error('stack trace and secrets'), {
        getPublicMessage: () => 'Internal FrontMCP error',
      });
      jest.spyOn(scope, 'runFlowForOutput').mockRejectedValue(serverError);

      await expect(ping.execute({}, { signal: new AbortController().signal })).rejects.toThrow(
        /^Internal FrontMCP error$/,
      );
      bridge.stop();
    });

    it('rejects with a non-Error failure as an Error', async () => {
      const { bridge, ping } = await registeredPing();
      jest.spyOn(scope, 'runFlowForOutput').mockRejectedValue('plain failure');

      await expect(ping.execute({}, { signal: new AbortController().signal })).rejects.toThrow('plain failure');
      bridge.stop();
    });

    it('joins only the text blocks of an error result', async () => {
      const { bridge, ping } = await registeredPing();
      jest.spyOn(scope, 'runFlowForOutput').mockResolvedValue({
        isError: true,
        content: [
          { type: 'text', text: 'first' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          { type: 'text', text: '' },
          { type: 'text', text: 'second' },
        ],
      } as never);

      await expect(ping.execute({}, { signal: new AbortController().signal })).rejects.toThrow('first\nsecond');
      bridge.stop();
    });
  });
});

describe('WebMcpPlugin', () => {
  it('parses its options when constructed', () => {
    expect(new WebMcpPlugin().options).toEqual({ prefix: '' });
    expect(new WebMcpPlugin({ prefix: 'shop.' }).options.prefix).toBe('shop.');
  });

  it('refuses a modelContext without registerTool', () => {
    expect(() => WebMcpPlugin.init({ modelContext: {} as never })).toThrow(/registerTool/);
  });

  describe('its bridge provider', () => {
    function bridgeFactory(options: WebMcpPluginOptionsInput) {
      const [provider] = WebMcpPlugin.dynamicProviders(options) as Array<{
        useFactory: (scope: ScopeEntry) => WebMcpBridge;
      }>;
      return provider.useFactory;
    }

    function fakeScope(ready: Promise<void>) {
      const disposers: Array<() => void> = [];
      const scope = {
        ready,
        logger: mockLogger(),
        tools: { subscribe: jest.fn(() => () => undefined) },
        onDispose: jest.fn((callback: () => void) => {
          disposers.push(callback);
          return () => undefined;
        }),
      };
      return { scope: scope as unknown as ScopeEntry & typeof scope, disposers };
    }

    it('starts the bridge once the scope is ready, and stops it when the scope is disposed', async () => {
      const { scope, disposers } = fakeScope(Promise.resolve());
      const bridge = bridgeFactory({ modelContext: new FakeModelContext() })(scope);
      const stop = jest.spyOn(bridge, 'stop');

      await settle();
      disposers.forEach((dispose) => dispose());

      expect(scope.tools.subscribe).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('never starts the bridge of a scope that failed to start', async () => {
      const { scope } = fakeScope(Promise.reject(new Error('scope failed')));
      bridgeFactory({ modelContext: new FakeModelContext() })(scope);

      await settle();

      expect(scope.tools.subscribe).not.toHaveBeenCalled();
    });
  });
});
