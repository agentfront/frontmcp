import {
  createEventStore,
  type buildScopedServerOptions,
  type ExecuteJobTool,
  type ExecuteWorkflowTool,
  type MemoryEventStore,
  type RecreateableSSEServerTransport,
  type RecreateableStreamableHTTPServerTransport,
  type RedisEventStore,
  type SSEServerTransport,
} from '@frontmcp/sdk';
import { ExecuteJobTool as SubpathExecuteJobTool } from '@frontmcp/sdk/job/tools';
import * as transport from '@frontmcp/sdk/transport';
import { ExecuteWorkflowTool as SubpathExecuteWorkflowTool } from '@frontmcp/sdk/workflow/tools';

export const jobTool: typeof ExecuteJobTool = SubpathExecuteJobTool;
export const workflowTool: typeof ExecuteWorkflowTool = SubpathExecuteWorkflowTool;
export const streamableTransport: typeof RecreateableStreamableHTTPServerTransport =
  transport.RecreateableStreamableHTTPServerTransport;
export const sseTransport: typeof RecreateableSSEServerTransport = transport.RecreateableSSEServerTransport;
export const baseSseTransport: typeof SSEServerTransport = transport.SSEServerTransport;
export const memoryStore: typeof MemoryEventStore = transport.MemoryEventStore;
export const redisStore: typeof RedisEventStore = transport.RedisEventStore;
export const serverOptions: typeof buildScopedServerOptions = transport.buildScopedServerOptions;

export function eventStoreOf(config: transport.EventStoreConfig): transport.EventStoreResult['eventStore'] {
  return createEventStore(config).eventStore;
}

export function notAConfig(): void {
  // @ts-expect-error createEventStore takes an EventStoreConfig
  transport.createEventStore('memory');
}
