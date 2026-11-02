/**
 * A plugin package that another copy of `@frontmcp/sdk` loads (the CommonJS build `require`s it from a server run as
 * ESM) cannot resolve the `FrontMcpLogger` class of this copy, but resolves `FRONTMCP_LOGGER`.
 */
import 'reflect-metadata';

import { FRONTMCP_LOGGER, FrontMcpLogger, LogLevel } from '../../common';
import { FrontMcpConfig } from '../../front-mcp/front-mcp.tokens';
import ProviderRegistry from '../../provider/provider.registry';
import LoggerRegistry from '../logger.registry';

describe('FRONTMCP_LOGGER', () => {
  it('is the server logger, under a token every copy of @frontmcp/sdk computes the same', async () => {
    const providers = new ProviderRegistry([
      { name: 'frontmcp:config', provide: FrontMcpConfig, useValue: { logging: { level: LogLevel.Off } } },
    ]);
    await providers.ready;
    await new LoggerRegistry(providers).ready;

    expect(FRONTMCP_LOGGER).toBe(Symbol.for('frontmcp:LOGGER'));
    expect(providers.get(FRONTMCP_LOGGER)).toBe(providers.get(FrontMcpLogger));
  });
});
