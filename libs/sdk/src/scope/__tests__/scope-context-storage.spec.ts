import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpContextStorage } from '../../context';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../scope.instance';

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'storage-app', name: 'storage-app', tools: [NoopTool] })
class StorageApp {}

describe('Scope context storage', () => {
  it('resolves the storage configured from @FrontMcp({ fetch }) from the providers its flows use', async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'scope-context-storage', version: '1.0.0' },
      apps: [StorageApp],
      logging: { level: LogLevel.Off },
      fetch: { forwardCallerTokenTo: ['https://api.example.com'] },
    });
    const scope = instance.getScopes()[0] as Scope;
    const storage = scope.providers.get(FrontMcpContextStorage);

    const config = storage.run(
      { sessionId: 'scope-storage', scopeId: scope.id },
      () => storage.getStoreOrThrow().config,
    );

    expect(config.forwardCallerTokenTo).toEqual(['https://api.example.com']);
  });
});
