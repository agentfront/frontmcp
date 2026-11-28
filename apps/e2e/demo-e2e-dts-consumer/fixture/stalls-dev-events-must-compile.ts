import 'reflect-metadata';

import {
  App,
  AsyncProvider,
  FrontMcp,
  FRONTMCP_LOGGER,
  registerWorkTracker,
  Tool,
  ToolContext,
  trackWork,
  type FrontMcpLogger,
  type Token,
  type WorkKind,
  type WorkSpan,
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

/** Background work outside a call, named in a stall while it runs. */
export async function ingestBatch(rows: readonly string[]): Promise<number> {
  const end: () => void = trackWork('ingest:batch');
  try {
    return rows.length;
  } finally {
    end();
  }
}

export const kinds: WorkKind[] = ['http', 'duty', 'worker', 'work'];

// @ts-expect-error a work span's kind is http, duty, worker or work
export const badKind: WorkKind = 'timer';

export const stopFollowing: () => void = registerWorkTracker({
  begin: (span: WorkSpan) => {
    const opened = `${span.kind} ${span.name}`;
    return () => void opened;
  },
});
