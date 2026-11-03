import { z } from '@frontmcp/sdk';

import type { DevEventSink } from '../dev-events/dev-event-stream';
import { ObservabilityConfigurationError } from './observability.errors';

/** Event-loop stall detection: a warning, a metric and a dev event for each stall, naming the calls in flight. */
export interface StallDetectionOptions {
  /** The shortest loop delay reported as a stall, in milliseconds (200 by default, from 20 to 60000). */
  thresholdMs?: number;
}

/** The `frontmcp dev` event stream: call timings, failures and stalls. Only on in development. */
export interface DevEventsOptions {
  /** A JSON Lines file to append the events to; `frontmcp dev` names one (`--events-file`) when this is unset. */
  file?: string;
  /** More places to send the events to. */
  sinks?: DevEventSink[];
  /** How many events wait for the sinks at most before new ones are dropped (1000 by default). */
  maxQueue?: number;
}

export interface ResolvedStallOptions {
  thresholdMs: number;
}

export interface ResolvedDevEventsOptions {
  file?: string;
  /** Whether to send the events to the dev parent over IPC (`frontmcp dev --stdio --serve`). */
  ipc: boolean;
  sinks: DevEventSink[];
  maxQueue: number;
}

/** Set by `frontmcp dev` on the server it starts: the events file, or `1` to send the events over IPC. */
export const DEV_EVENTS_FILE_ENV = 'FRONTMCP_DEV_EVENTS_FILE';
export const DEV_EVENTS_IPC_ENV = 'FRONTMCP_DEV_EVENTS_IPC';

const thresholdMessage = { message: 'must be a whole number of milliseconds from 20 to 60000' };
const maxQueueMessage = { message: 'must be a whole number from 1 to 100000' };

const stallOptionsSchema = z
  .object({
    thresholdMs: z.number().int(thresholdMessage).min(20, thresholdMessage).max(60_000, thresholdMessage).default(200),
  })
  .strict();

const isSink = (value: unknown): value is DevEventSink =>
  typeof value === 'object' && value !== null && typeof (value as { write?: unknown }).write === 'function';

const devEventsOptionsSchema = z
  .object({
    file: z.string().min(1, { message: 'must be a file path' }).optional(),
    sinks: z
      .array(z.custom<DevEventSink>(isSink, { message: 'must be a sink: an object with a write(events) method' }))
      .default([]),
    maxQueue: z.number().int(maxQueueMessage).min(1, maxQueueMessage).max(100_000, maxQueueMessage).default(1000),
  })
  .strict();

function parse<T>(option: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${[option, ...issue.path].join('.')}: ${issue.message}`);
  throw new ObservabilityConfigurationError(`Invalid ObservabilityPlugin options: ${problems.join('; ')}`);
}

export function resolveStallOptions(input: boolean | StallDetectionOptions | undefined): ResolvedStallOptions | false {
  if (input === undefined || input === false) return false;
  return parse('stalls', stallOptionsSchema, input === true ? {} : input);
}

/**
 * The dev event stream's options, or `false` when it is off: outside development (no `frontmcp dev` and
 * `NODE_ENV` not `development`), when turned off, or with nowhere to write.
 */
export function resolveDevEventsOptions(
  input: boolean | DevEventsOptions | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDevEventsOptions | false {
  if (input === false) return false;
  const options = parse('devEvents', devEventsOptionsSchema, input === true || input === undefined ? {} : input);
  const envFile = env[DEV_EVENTS_FILE_ENV] || undefined;
  const ipc = env[DEV_EVENTS_IPC_ENV] === '1';
  const inDevelopment = envFile !== undefined || ipc || env['NODE_ENV'] === 'development';
  const file = options.file ?? envFile;
  if (!inDevelopment || (!file && !ipc && options.sinks.length === 0)) return false;
  return { ...(file ? { file } : {}), ipc, sinks: options.sinks, maxQueue: options.maxQueue };
}
