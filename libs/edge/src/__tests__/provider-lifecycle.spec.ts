import 'reflect-metadata';

import { App, LogLevel, Provider, Tool, ToolContext, type OnBootstrap, type OnReady } from '@frontmcp/sdk';

import { createEdgeMcp } from '../index';

const phases: string[] = [];

@Provider({ name: 'warm-cache' })
class WarmCache implements OnBootstrap, OnReady {
  onBootstrap() {
    phases.push('bootstrap');
  }
  onReady() {
    phases.push('ready');
  }
}

@Tool({ name: 'lookup', inputSchema: {} })
class LookupTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [LookupTool], providers: [WarmCache] })
class DeskApp {}

function initialize(id: number): Request {
  return new Request('https://desk.example.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1.0.0' } },
    }),
  });
}

const config = {
  info: { name: 'edge-lifecycle', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

describe('provider lifecycle on the edge module', () => {
  beforeEach(() => {
    phases.length = 0;
  });

  it('readies the providers once, when the first request builds the server', async () => {
    const worker = createEdgeMcp(config);
    expect(phases).toEqual([]);

    expect((await worker.fetch(initialize(1))).status).toBe(200);
    expect(phases).toEqual(['bootstrap', 'ready']);

    expect((await worker.fetch(initialize(2))).status).toBe(200);
    expect(phases).toEqual(['bootstrap', 'ready']);
  });

  it('readies the providers of a session Durable Object once, when its first request builds its scope', async () => {
    const session = new (createEdgeMcp(config).SessionDurableObject)({}, {});

    expect((await session.fetch(initialize(1))).status).toBe(200);
    expect(phases).toEqual(['bootstrap', 'ready']);

    await session.fetch(initialize(2));
    expect(phases).toEqual(['bootstrap', 'ready']);
  });
});
