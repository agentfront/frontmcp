import 'reflect-metadata';

import { LogLevel, Tool, ToolContext } from '../../common';
import { frontMcpBaseSchema } from '../../common/metadata/front-mcp.metadata';
import { FrontMcpLocalAppTokens } from '../../common/tokens';
import { buildConfig, create } from '../create';
import { type CreateConfig } from '../create.types';

@Tool({ name: 'granted_scopes', inputSchema: {} })
class GrantedScopesTool extends ToolContext {
  async execute() {
    return { scopes: this.auth.scopes };
  }
}

@Tool({ name: 'server_options', inputSchema: {} })
class ServerOptionsTool extends ToolContext {
  async execute() {
    const { ui, fetch, instructions } = this.scope.metadata;
    return { ui, fetch, instructions };
  }
}

@Tool({ name: 'purge_closed', inputSchema: {}, authorities: 'admin' })
class PurgeClosedTool extends ToolContext {
  async execute() {
    return { purged: 31 };
  }
}

/** `@FrontMcp` options `create()` sets on the server itself. */
const SET_BY_CREATE = ['apps', 'serve'];

/** `@FrontMcp` options `create()` gives its synthetic app, which serves them to the whole server. */
const GIVEN_TO_THE_APP = ['tools', 'resources', 'skills', 'plugins', 'adapters', 'providers'];

const serverOptionNames = [...Object.keys(frontMcpBaseSchema.shape), 'auth'].filter(
  (name) => name !== 'info' && !SET_BY_CREATE.includes(name),
);

describe('create()', () => {
  it.each(serverOptionNames)('does not drop the @FrontMcp option %s', (name) => {
    const value = { option: name };

    const config = buildConfig({ info: { name: 'create-options', version: '1.0.0' }, [name]: value } as CreateConfig);

    if (GIVEN_TO_THE_APP.includes(name)) {
      const token = FrontMcpLocalAppTokens[name as keyof typeof FrontMcpLocalAppTokens];
      expect(Reflect.getMetadata(token, config.apps[0])).toBe(value);
    } else {
      expect((config as Record<string, unknown>)[name]).toBe(value);
    }
  });

  it('gives its tools the server options it was created with', async () => {
    const server = await create({
      info: { name: 'create-server-options', version: '1.0.0' },
      tools: [ServerOptionsTool],
      ui: { escapeStringResults: false },
      fetch: { forwardCallerTokenTo: ['https://billing.example.com'] },
      instructions: 'Use the desk tools for tickets.',
      logging: { level: LogLevel.Off },
    });

    const result = await server.callTool('server_options', {});
    await server.dispose();

    expect(result.structuredContent).toEqual({
      ui: { escapeStringResults: false },
      fetch: expect.objectContaining({ forwardCallerTokenTo: ['https://billing.example.com'] }),
      instructions: 'Use the desk tools for tickets.',
    });
  });

  it('starts a server whose tools use its authorities profiles', async () => {
    const server = await create({
      info: { name: 'create-authorities', version: '1.0.0' },
      tools: [PurgeClosedTool],
      authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
      logging: { level: LogLevel.Off },
    });

    const admin = { authContext: { user: { sub: 'nour', roles: ['admin'] } } };
    const result = await server.callTool('purge_closed', {}, admin);
    const refused = server.callTool('purge_closed', {}, { authContext: { user: { sub: 'sam' } } });
    await expect(refused).rejects.toBeDefined();
    await server.dispose();

    expect(result.structuredContent).toEqual({ purged: 31 });
  });

  it('passes output and throttle on to the server', () => {
    const output = { allowNonFinite: true };
    const throttle = { enabled: true, globalConcurrency: { maxConcurrent: 2 } };

    const config = buildConfig({ info: { name: 'create-options', version: '1.0.0' }, output, throttle });

    expect(config).toEqual(expect.objectContaining({ output, throttle }));
  });

  it('gives an in-process call the scopes of its authContext', async () => {
    const server = await create({
      info: { name: 'create-scopes', version: '1.0.0' },
      tools: [GrantedScopesTool],
      logging: { level: LogLevel.Off },
    });

    const result = await server.callTool('granted_scopes', {}, { authContext: { scopes: ['tickets:read'] } });
    await server.dispose();

    expect(result.structuredContent).toEqual({ scopes: ['tickets:read'] });
  });
});
