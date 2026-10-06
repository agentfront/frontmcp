import 'reflect-metadata';

import { LogLevel, Tool, ToolContext } from '../../common';
import { buildConfig, create } from '../create';

@Tool({ name: 'granted_scopes', inputSchema: {} })
class GrantedScopesTool extends ToolContext {
  async execute() {
    return { scopes: this.auth.scopes };
  }
}

describe('create()', () => {
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
