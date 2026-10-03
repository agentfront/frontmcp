/**
 * `SomeAdapter.init({ name, inject, useFactory })` (#678).
 *
 * The factory returns the adapter's options, as `DynamicPlugin.init({ useFactory })` factories do,
 * but the registry used what it returned as the adapter itself. Start-up failed with
 * `Cannot read properties of undefined (reading 'name')`, and the adapter's own start-up, left
 * running, rejected a second time (`reading 'description'`) with nothing to handle it: a Node
 * process without an `unhandledRejection` handler exited.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { Adapter } from '../../common/decorators/adapter.decorator';
import { Tool } from '../../common/decorators/tool.decorator';
import { DynamicAdapter } from '../../common/dynamic/dynamic.adapter';
import { FrontMcpLogger, ToolContext, type FrontMcpAdapterResponse } from '../../common/interfaces';
import { InvalidEntityError } from '../../errors';
import { type AdapterInstance } from '../adapter.instance';
import AdapterRegistry from '../adapter.registry';
import { normalizeAdapter } from '../adapter.utils';

const BASE_URL_TOKEN = Symbol('factory-adapter-base-url');

interface EchoAdapterOptions {
  name: string;
  baseUrl: string;
  description?: string;
}

@Tool({ name: 'factory_adapter_echo', description: 'Echoes the base URL', inputSchema: {} })
class EchoTool extends ToolContext {
  async execute(): Promise<string> {
    return 'echo';
  }
}

const constructed: EchoAdapterOptions[] = [];

@Adapter({ name: 'echo-adapter', description: 'Builds one tool per configured base URL' })
class EchoAdapter extends DynamicAdapter<EchoAdapterOptions> {
  options: EchoAdapterOptions;

  constructor(options: EchoAdapterOptions) {
    super();
    this.options = options;
    constructed.push(options);
  }

  fetch(): FrontMcpAdapterResponse {
    return { tools: [EchoTool] };
  }
}

/** The same adapter as `EchoAdapter`, as a second bundle of its package would define it: a distinct class. */
class EchoAdapterFromAnotherBundle extends DynamicAdapter<EchoAdapterOptions> {
  options: EchoAdapterOptions;

  constructor(options: EchoAdapterOptions) {
    super();
    this.options = options;
  }

  fetch(): FrontMcpAdapterResponse {
    return { tools: [EchoTool] };
  }
}

let nameCounter = 0;
const uniqueName = (base: string) => `${base}-${++nameCounter}`;

function silentLogger(): FrontMcpLogger {
  const logger = {
    verbose: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: () => logger,
  };
  return logger as unknown as FrontMcpLogger;
}

async function providersWithLogger() {
  return createProviderRegistryWithScope([
    { name: 'logger', provide: FrontMcpLogger, useValue: silentLogger() },
    { name: 'base-url', provide: BASE_URL_TOKEN, useValue: 'https://api.example.com' },
  ]);
}

async function install(record: unknown) {
  const registry = new AdapterRegistry(await providersWithLogger(), [record as never]);
  await registry.ready;
  return registry;
}

/** Names of the tools the registry's single adapter contributes. */
function toolNames(registry: AdapterRegistry): string[] {
  const [adapter] = registry.getAdapters() as AdapterInstance[];
  const tools = adapter.getTools().getTools(true);
  return tools.map((t) => t.name);
}

describe('DynamicAdapter.init({ name, inject, useFactory })', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    constructed.length = 0;
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  it('constructs the adapter class with the options the factory returns', async () => {
    const name = uniqueName('factory');
    const registry = await install(
      EchoAdapter.init({
        name,
        inject: () => [BASE_URL_TOKEN] as const,
        useFactory: (baseUrl: string) => ({ name, baseUrl }),
      }),
    );

    expect(constructed).toEqual([{ name, baseUrl: 'https://api.example.com' }]);
    expect(toolNames(registry)).toEqual(['factory_adapter_echo']);
  });

  it('accepts a factory that resolves the options asynchronously', async () => {
    const name = uniqueName('async-factory');
    await install(
      EchoAdapter.init({
        name,
        inject: () => [BASE_URL_TOKEN] as const,
        useFactory: async (baseUrl: string) => ({ name, baseUrl: `${baseUrl}/v2` }),
      }),
    );

    expect(constructed).toEqual([{ name, baseUrl: 'https://api.example.com/v2' }]);
  });

  it('names the adapter with the name given to init when the factory leaves it out', async () => {
    const name = uniqueName('unnamed-factory');
    await install(
      EchoAdapter.init({
        name,
        inject: () => [] as const,
        useFactory: () => ({ baseUrl: 'https://other.example.com' }) as EchoAdapterOptions,
      }),
    );

    expect(constructed).toEqual([{ name, baseUrl: 'https://other.example.com' }]);
  });

  it('keeps an adapter instance a hand-written factory returns', async () => {
    const name = uniqueName('instance-factory');
    const produced = new EchoAdapter({ name, baseUrl: 'https://instance.example.com' });
    constructed.length = 0;

    const registry = await install(EchoAdapter.init({ name, inject: () => [] as const, useFactory: () => produced }));

    expect(constructed).toEqual([]);
    expect(registry.getAdapters()).toHaveLength(1);
  });

  it('keeps an adapter instance a factory resolves asynchronously', async () => {
    const name = uniqueName('async-instance-factory');
    const produced = new EchoAdapter({ name, baseUrl: 'https://instance.example.com' });
    constructed.length = 0;

    const registry = await install(
      EchoAdapter.init({ name, inject: () => [] as const, useFactory: async () => produced }),
    );

    expect(constructed).toEqual([]);
    expect(registry.getAdapters()).toHaveLength(1);
  });

  it('keeps an adapter built from another copy of the adapter class instead of rebuilding it from its fields', async () => {
    const name = uniqueName('other-copy-factory');
    const produced = new EchoAdapterFromAnotherBundle({ name, baseUrl: 'https://copy.example.com' });

    const registry = await install(EchoAdapter.init({ name, inject: () => [] as const, useFactory: () => produced }));

    expect(constructed).toEqual([]);
    expect(toolNames(registry)).toEqual(['factory_adapter_echo']);
  });

  it('fails start-up when a factory returns an adapter named differently from the name given to init', async () => {
    const name = uniqueName('renamed-instance');
    const produced = new EchoAdapter({ name: 'some-other-name', baseUrl: 'https://instance.example.com' });

    const started = install(EchoAdapter.init({ name, inject: () => [] as const, useFactory: () => produced }));

    await expect(started).rejects.toThrow(InvalidEntityError);
    await expect(started).rejects.toThrow(
      `Invalid adapter '${name}'. Expected useFactory to return an adapter named '${name}', ` +
        `the name given to init(), not 'some-other-name'.`,
    );
  });

  it('fails start-up with one clear error, and nothing else rejects unhandled, when a factory builds no adapter', async () => {
    const record = { provide: Symbol('hand-written-factory'), inject: () => [] as const, useFactory: () => ({}) };

    await expect(install(record)).rejects.toThrow(InvalidEntityError);
    await expect(install({ ...record, provide: Symbol('hand-written-factory') })).rejects.toThrow(
      /Expected an adapter: an object with `options.name` and `fetch\(\)`/,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).toEqual([]);
  });

  it('fails start-up with a clear error when an init factory returns no options', async () => {
    const name = uniqueName('no-options');
    const record = EchoAdapter.init({ name, inject: () => [] as const, useFactory: () => null as never });

    await expect(install(record)).rejects.toThrow(
      `Invalid adapter '${name}'. Expected useFactory to return the adapter's options object.`,
    );
  });

  it('builds the adapter metadata from the name given to init', () => {
    const name = uniqueName('metadata');
    const record = EchoAdapter.init({ name, inject: () => [] as const, useFactory: () => ({ name, baseUrl: 'x' }) });

    expect(normalizeAdapter(record).metadata).toEqual({ name });
  });

  it('fails start-up, without unhandled rejections, when several adapters fail', async () => {
    const providers = await providersWithLogger();
    const failing = (id: string) => ({ provide: Symbol(id), inject: () => [] as const, useFactory: () => ({}) });

    const registry = new AdapterRegistry(providers, [failing('first') as never, failing('second') as never]);

    await expect(registry.ready).rejects.toThrow(InvalidEntityError);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  });

  it('lets adapters it already started settle when registering a later one throws', async () => {
    const logger = silentLogger();
    const registrationError = new Error('logger failed');
    (logger.verbose as jest.Mock).mockImplementation(() => {
      throw registrationError;
    });
    const providers = await createProviderRegistryWithScope([
      { name: 'logger', provide: FrontMcpLogger, useValue: logger },
    ]);
    const failing = { provide: Symbol('started-then-orphaned'), inject: () => [] as const, useFactory: () => ({}) };

    const registry = new AdapterRegistry(providers, [failing as never]);

    await expect(registry.ready).rejects.toBe(registrationError);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  });
});
