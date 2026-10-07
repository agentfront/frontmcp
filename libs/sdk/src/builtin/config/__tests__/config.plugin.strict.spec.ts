/**
 * `ConfigPlugin`'s `strict`: settings that don't match the schema stop the server by default, and with
 * `strict: false` are served as read, with a warning.
 */
import { z } from '@frontmcp/lazy-zod';

import 'reflect-metadata';

import { App, LogLevel, type FrontMcpLogger } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import ConfigPlugin from '../config.plugin';
import { ConfigPluginConfigToken } from '../config.symbols';
import type { ConfigPluginOptions } from '../config.types';
import { ConfigService, ConfigValidationError } from '../providers/config.service';

const schema = z.object({ desk: z.object({ pageSize: z.number() }) });

type ServiceFactory = (options: ConfigPluginOptions<object>, logger: FrontMcpLogger) => Promise<ConfigService<object>>;

async function buildService(strict?: boolean) {
  const providers = ConfigPlugin.dynamicProviders({ schema, loadEnv: false, strict });
  const options = providers.find((provider) => 'provide' in provider && provider.provide === ConfigPluginConfigToken);
  const service = providers.find((provider) => 'provide' in provider && provider.provide === ConfigService);
  const warn = jest.fn();
  const logger = { warn } as unknown as FrontMcpLogger;
  const factory = (service as { useFactory: ServiceFactory }).useFactory;
  const build = () => factory((options as { useValue: ConfigPluginOptions<object> }).useValue, logger);
  return { build, warn };
}

describe('ConfigPlugin strict', () => {
  it('stops startup with ConfigValidationError when the settings do not match the schema', async () => {
    const { build } = await buildService();

    await expect(build()).rejects.toThrow(ConfigValidationError);
  });

  it('with strict: false, logs the validation error and serves the settings as read', async () => {
    const { build, warn } = await buildService(false);

    const service = await build();

    expect(service.getAll()).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Configuration validation failed'));
  });

  it('with strict: false, a server with settings that do not match the schema starts', async () => {
    @App({ id: 'desk', name: 'Desk', plugins: [ConfigPlugin.init({ schema, loadEnv: false, strict: false })] })
    class DeskApp {}

    const server = await FrontMcpInstance.createDirect({
      info: { name: 'help-desk', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });

    await expect(server.listTools()).resolves.toEqual(expect.objectContaining({ tools: [] }));
    await server.dispose();
  });
});
