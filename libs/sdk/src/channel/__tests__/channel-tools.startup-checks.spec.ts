/**
 * The tools a `@Channel` contributes join the server after its startup checks ran, so a channel tool that declared
 * `authorities` on a server without the `authorities` option, or `approval` with no plugin that enforces it, was
 * served while nothing checked it. The server now refuses to start, as it does for any other tool.
 */
import 'reflect-metadata';

import {
  App,
  Channel,
  ChannelContext,
  LogLevel,
  Tool,
  ToolContext,
  type ChannelNotification,
  type FrontMcpConfigInput,
} from '../../common';
import { AuthConfigurationError, UnenforcedMetadataError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

// The plugin fields are declared by type augmentation these tests do not load, so they are passed as untyped metadata.
function channelWithTool(toolName: string, toolMetadata: Record<string, unknown>) {
  @Tool({ name: toolName, inputSchema: {}, ...toolMetadata })
  class ChannelTool extends ToolContext {
    async execute() {
      return { done: true };
    }
  }

  @Channel({ name: `${toolName}_channel`, source: { type: 'manual' }, tools: [ChannelTool] })
  class ToolChannel extends ChannelContext {
    async onEvent(payload: unknown): Promise<ChannelNotification> {
      return { content: String(payload) };
    }
  }
  return ToolChannel;
}

function server(channel: unknown, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  @App({ id: 'desk', name: 'Desk', channels: [channel as never] })
  class DeskApp {}
  return {
    info: { name: 'channel-tool-checks', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    channels: { enabled: true },
    ...extra,
  };
}

async function start(config: FrontMcpConfigInput): Promise<void> {
  const direct = await FrontMcpInstance.createDirect(config);
  await direct.dispose();
}

describe("startup checks of a channel's tools", () => {
  it('refuses to start when a channel tool declares authorities and no engine checks them', async () => {
    const startup = start(server(channelWithTool('purge_inbox', { authorities: { roles: { any: ['admin'] } } })));

    await expect(startup).rejects.toBeInstanceOf(AuthConfigurationError);
    await expect(startup).rejects.toThrow(/Tool "purge_inbox"/);
  });

  it('refuses to start when a channel tool asks for approval no plugin enforces', async () => {
    const startup = start(server(channelWithTool('send_wire', { approval: true })));

    await expect(startup).rejects.toBeInstanceOf(UnenforcedMetadataError);
    await expect(startup).rejects.toThrow(/Tool "send_wire".*'approval'/);
  });

  it('starts when the authorities option configures the engine', async () => {
    const channel = channelWithTool('archive_inbox', { authorities: { roles: { any: ['admin'] } } });

    await expect(start(server(channel, { authorities: {} }))).resolves.toBeUndefined();
  });
});
