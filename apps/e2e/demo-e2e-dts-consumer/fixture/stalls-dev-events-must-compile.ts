import 'reflect-metadata';

import { App, FrontMcp, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'ping', inputSchema: {} })
export class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ name: 'Ping', tools: [PingTool] })
export class PingApp {}

const written: unknown[] = [];

@FrontMcp({
  info: { name: 'stalls', version: '1.0.0' },
  apps: [PingApp],
  observability: {
    tracing: false,
    stalls: { thresholdMs: 200 },
    devEvents: {
      file: '.frontmcp/dev-events.jsonl',
      sinks: [{ name: 'memory', write: (events) => void written.push(...events) }],
      maxQueue: 500,
    },
  },
})
export class StallsServer {}

@FrontMcp({
  info: { name: 'stalls-defaults', version: '1.0.0' },
  apps: [PingApp],
  observability: { stalls: true, devEvents: false },
})
export class StallsDefaultsServer {}
