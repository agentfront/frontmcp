import 'reflect-metadata';

import {
  App,
  AsyncProvider,
  FrontMcp,
  FRONTMCP_LOGGER,
  Tool,
  ToolContext,
  type FrontMcpLogger,
  type Token,
} from '@frontmcp/sdk';

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

const MONITOR_LOGGER: Token<FrontMcpLogger> = Symbol('MonitorLogger');

export const monitorLogger = AsyncProvider({
  provide: MONITOR_LOGGER,
  inject: () => [FRONTMCP_LOGGER] as const,
  useFactory: async (logger: FrontMcpLogger): Promise<FrontMcpLogger> => logger.child('Monitor'),
});
