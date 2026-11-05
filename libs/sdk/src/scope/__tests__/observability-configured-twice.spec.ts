/**
 * `@FrontMcp({ observability })` adds its own ObservabilityPlugin to the server's plugins list. A server that also
 * lists ObservabilityPlugin there refuses to start with an error that names both places, not two list entries.
 */
import 'reflect-metadata';

import { DynamicPlugin, LogLevel, Plugin, Tool, ToolContext } from '../../common';
import { DuplicatePluginEntryError, PluginConfiguredTwiceError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { registerOptionalModule } from '../optional-dependency.util';

interface ObservabilityOptions {
  tracing?: boolean;
  logging?: boolean;
}

@Tool({ name: 'observability_probe', inputSchema: {} })
class ObservabilityProbeTool extends ToolContext {
  async execute() {
    return 'installed';
  }
}

@Plugin({ name: 'observability', tools: [ObservabilityProbeTool] })
class ObservabilityPlugin extends DynamicPlugin<ObservabilityOptions> {
  constructor(readonly options: ObservabilityOptions) {
    super();
  }
}

const OFF: ObservabilityOptions = { tracing: false, logging: false };

function startServer(config: Record<string, unknown>) {
  return FrontMcpInstance.createDirect({
    info: { name: 'observability-configured-twice', version: '1.0.0' },
    logging: { level: LogLevel.Off },
    apps: [],
    ...config,
  } as never);
}

beforeAll(() => {
  registerOptionalModule('@frontmcp/observability', { ObservabilityPlugin });
});

describe('ObservabilityPlugin configured by @FrontMcp({ observability }) and by a plugins entry', () => {
  it('refuses to start, naming the option and the entry', async () => {
    const started = startServer({ observability: OFF, plugins: [ObservabilityPlugin.init(OFF)] });

    await expect(started).rejects.toThrow(PluginConfiguredTwiceError);
    await expect(started).rejects.toThrow(
      'ObservabilityPlugin is configured twice: by @FrontMcp({ observability }) and by an ObservabilityPlugin entry ' +
        "in @FrontMcp({ plugins }). Configure it in one place: move the entry's options to observability and " +
        'remove the entry, or remove observability.',
    );
    await expect(started).rejects.not.toThrow(DuplicatePluginEntryError);
  });

  it('starts with the option alone, and installs its ObservabilityPlugin', async () => {
    const server = await startServer({ observability: OFF });

    expect((await server.listTools()).tools.map((tool) => tool.name)).toEqual(['observability_probe']);
    await server.dispose();
  });

  it('starts with the entry alone', async () => {
    const server = await startServer({ plugins: [ObservabilityPlugin.init(OFF)] });

    expect((await server.listTools()).tools.map((tool) => tool.name)).toEqual(['observability_probe']);
    await server.dispose();
  });
});
