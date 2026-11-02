import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { randomUUID } from '@frontmcp/utils';

import {
  App,
  frontMcpMetadataSchema,
  LogLevel,
  Provider,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type OnBootstrap,
  type OnReady,
  type OnShutdown,
} from '../../common';
import { connect } from '../../direct';
import { ProviderBootstrapError } from '../../errors';
import { FrontMcpInstance } from '../front-mcp';

const phases: string[] = [];

@Provider({ name: 'pool' })
class Pool implements OnBootstrap, OnReady, OnShutdown {
  onBootstrap() {
    phases.push('bootstrap:pool');
  }
  onReady() {
    phases.push('ready:pool');
  }
  async onShutdown() {
    phases.push('shutdown:pool');
  }
}

@Provider({ name: 'repo' })
class Repo implements OnBootstrap, OnReady, OnShutdown {
  constructor(readonly pool: Pool) {}
  async onBootstrap() {
    phases.push('bootstrap:repo');
  }
  async onReady() {
    phases.push('ready:repo');
  }
  onShutdown() {
    phases.push('shutdown:repo');
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'demo', name: 'Demo', providers: [Repo], tools: [PingTool] })
class DemoApp {}

function lifecycleConfig(extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'lifecycle', version: '1.0.0' },
    apps: [DemoApp],
    providers: [Pool],
    logging: { level: LogLevel.Off, enableConsole: false },
    ...extra,
  } as FrontMcpConfigInput;
}

const BOOTSTRAPPED = ['bootstrap:pool', 'bootstrap:repo'];
const READY = ['ready:pool', 'ready:repo'];
const SHUT_DOWN = ['shutdown:repo', 'shutdown:pool'];

describe('Provider lifecycle on every transport', () => {
  let muted: jest.SpyInstance;

  beforeEach(() => {
    phases.length = 0;
    muted = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    muted.mockRestore();
  });

  it('readies the providers once the HTTP server listens, and shuts them down after it stops', async () => {
    const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse(lifecycleConfig({ http: { port: 0 } })));
    await instance.ready;
    expect(phases).toEqual(BOOTSTRAPPED);

    await instance.start();
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);

    await instance.shutdown();
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY, ...SHUT_DOWN]);
  });

  it('readies the providers once the Unix socket listens, and shuts them down on close()', async () => {
    const socketPath = path.join(os.tmpdir(), `lifecycle-${randomUUID().slice(0, 8)}.sock`);
    const handle = await FrontMcpInstance.runUnixSocket({ ...lifecycleConfig(), socketPath });
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);

    await handle.close();
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY, ...SHUT_DOWN]);
  });

  it('readies the providers before createDirect() returns, and shuts them down on dispose()', async () => {
    const server = await FrontMcpInstance.createDirect(lifecycleConfig());
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);

    await server.dispose();
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY, ...SHUT_DOWN]);
  });

  it('readies a connected server once for every client, and shuts it down when the last one closes', async () => {
    const config = lifecycleConfig();
    const first = await connect(config);
    const second = await connect(config);
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);

    await first.close();
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);
    await second.close();
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY, ...SHUT_DOWN]);
  });

  it('readies the providers of a serverless handler and of a fetch handler', async () => {
    await FrontMcpInstance.createHandler(lifecycleConfig());
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);

    phases.length = 0;
    await FrontMcpInstance.createFetchHandler(lifecycleConfig());
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY]);
  });

  it('fails to start with ProviderBootstrapError when a provider cannot bootstrap', async () => {
    @Provider({ name: 'broken' })
    class Broken implements OnBootstrap {
      onBootstrap() {
        throw new Error('migrations pending');
      }
    }

    const failure = FrontMcpInstance.createDirect(lifecycleConfig({ providers: [Pool, Broken] }));

    await expect(failure).rejects.toBeInstanceOf(ProviderBootstrapError);
    await expect(failure).rejects.toThrow('Provider "Broken" failed in onBootstrap(): migrations pending');
    expect(phases).toEqual(['bootstrap:pool', 'shutdown:pool']);
  });

  it('gives up on an onShutdown() that outlasts lifecycle.shutdownHookTimeoutMs', async () => {
    @Provider({ name: 'hung' })
    class Hung implements OnShutdown {
      onShutdown() {
        return new Promise<void>(() => undefined);
      }
    }
    const server = await FrontMcpInstance.createDirect(
      lifecycleConfig({ providers: [Pool, Hung], lifecycle: { shutdownHookTimeoutMs: 20 } }),
    );

    const started = Date.now();
    await server.dispose();

    expect(Date.now() - started).toBeLessThan(2000);
    expect(phases).toEqual([...BOOTSTRAPPED, ...READY, ...SHUT_DOWN]);
  });

  it.each([
    [{ shutdownHookTimeoutMs: 0 }, 'lifecycle.shutdownHookTimeoutMs must be greater than 0'],
    [{ shutdownHookTimeoutMs: 1.5 }, 'lifecycle.shutdownHookTimeoutMs must be a whole number of milliseconds'],
    [{ shutdownTimeout: 100 }, 'shutdownTimeout'],
  ])('refuses lifecycle %j', (lifecycle, message) => {
    expect(() => frontMcpMetadataSchema.parse(lifecycleConfig({ lifecycle } as Partial<FrontMcpConfigInput>))).toThrow(
      message,
    );
  });
});

describe('A server-level value shared by the scopes of a splitByApp server', () => {
  const order: string[] = [];

  class SharedConnection implements OnShutdown {
    onShutdown() {
      order.push('shutdown:connection');
    }
  }

  @Provider({ name: 'first-store' })
  class FirstStore implements OnShutdown {
    constructor(readonly connection: SharedConnection) {}
    onShutdown() {
      order.push('shutdown:first-store');
    }
  }

  @Provider({ name: 'second-store' })
  class SecondStore implements OnShutdown {
    constructor(readonly connection: SharedConnection) {}
    onShutdown() {
      order.push('shutdown:second-store');
    }
  }

  @App({ id: 'first', name: 'First', providers: [FirstStore], tools: [PingTool] })
  class FirstApp {}

  @App({ id: 'second', name: 'Second', providers: [SecondStore], tools: [PingTool] })
  class SecondApp {}

  it('shuts the value down after the providers of every scope that depend on it', async () => {
    const instance = new FrontMcpInstance(
      frontMcpMetadataSchema.parse({
        info: { name: 'split-lifecycle', version: '1.0.0' },
        apps: [FirstApp, SecondApp],
        splitByApp: true,
        providers: [{ provide: SharedConnection, name: 'connection', useValue: new SharedConnection() }],
        logging: { level: LogLevel.Off, enableConsole: false },
      }),
    );
    await instance.ready;

    await instance.shutdown();

    expect(order).toHaveLength(3);
    expect(order[2]).toBe('shutdown:connection');
  });
});
