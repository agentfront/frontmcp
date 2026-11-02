import { z } from '@frontmcp/lazy-zod';
import { readFile } from '@frontmcp/utils';

import { McpTestClient } from '../client/mcp-test-client';
import type { McpTestClientConfig } from '../client/mcp-test-client.types';
import { ReplayRecordingError } from '../errors';
import {
  compareCall,
  REPLAYED_METHODS,
  replayedAnswerOf,
  type CallComparison,
  type CompareOptions,
  type RecordedCall,
  type ReplayedMethod,
  type ReplayOutcome,
} from './replay-diff';

export interface ReplayedCall extends CallComparison {
  /** The call's line in the recording, from 1. */
  line: number;
  method: ReplayedMethod;
  name: string;
}

export interface ReplayReport {
  file: string;
  calls: ReplayedCall[];
  /** The calls whose outcome is not `same`. */
  differences: ReplayedCall[];
}

export interface ReplaySessionOptions extends CompareOptions {
  /** How each replay client connects (`auth`, `publicMode`, `entryPath`, ...); the server gives the `baseUrl`. */
  client?: Omit<McpTestClientConfig, 'baseUrl'>;
}

/** A running server (a `TestServer`, the `server` fixture), or its base URL. */
export type ReplayTarget = string | { info: { baseUrl: string } };

const recordedCallSchema = z.object({
  v: z.literal(1, { message: 'is not a recording version this replay reads' }),
  method: z.enum(REPLAYED_METHODS, { message: `must be one of ${REPLAYED_METHODS.join(', ')}` }),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  answer: z.unknown().optional(),
  error: z.object({ code: z.union([z.string(), z.number()]), message: z.string().optional() }).optional(),
  session: z.string().optional(),
  client: z.object({ name: z.string(), version: z.string() }).optional(),
});

const OUTCOME_LABELS: Record<ReplayOutcome, string> = {
  same: 'same',
  changed: 'changed',
  'new-error': 'new error',
  'gone-error': 'gone error',
};

function parseCall(text: string, file: string, line: number): RecordedCall {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReplayRecordingError(file, line, 'it is not JSON');
  }
  const parsed = recordedCallSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new ReplayRecordingError(file, line, problems.join('; '));
}

async function readRecording(file: string): Promise<Array<{ line: number; call: RecordedCall }>> {
  const lines = (await readFile(file)).split(/\r?\n/);
  return lines.flatMap((text, index) =>
    text.trim() === '' ? [] : [{ line: index + 1, call: parseCall(text, file, index + 1) }],
  );
}

function paramsOf(call: RecordedCall): Record<string, unknown> {
  if (call.method === 'resources/read') return { uri: call.name };
  return { name: call.name, ...(call.input && { arguments: call.input }) };
}

/** Replays a `CallRecorderPlugin` recording in order, one client per recorded session, and compares each answer. */
export async function replaySession(
  file: string,
  server: ReplayTarget,
  options: ReplaySessionOptions = {},
): Promise<ReplayReport> {
  const recording = await readRecording(file);
  const baseUrl = typeof server === 'string' ? server : server.info.baseUrl;
  const clients = new Map<string, McpTestClient>();
  const calls: ReplayedCall[] = [];
  try {
    for (const { line, call } of recording) {
      const session = call.session ?? '';
      let client = clients.get(session);
      if (!client) {
        const clientInfo = call.client ?? options.client?.clientInfo;
        client = await McpTestClient.create({
          ...options.client,
          baseUrl,
          ...(clientInfo && { clientInfo }),
        }).buildAndConnect();
        clients.set(session, client);
      }
      const response = await client.raw.request({
        jsonrpc: '2.0',
        id: line,
        method: call.method,
        params: paramsOf(call),
      });
      calls.push({
        line,
        method: call.method,
        name: call.name,
        ...compareCall(call, replayedAnswerOf(response), options),
      });
    }
  } finally {
    await Promise.allSettled([...clients.values()].map((client) => client.disconnect()));
  }
  return { file, calls, differences: calls.filter(({ outcome }) => outcome !== 'same') };
}

function preview(value: unknown): string {
  if (value === undefined) return '(none)';
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
}

/** The calls of a replay that differ from the recording, and how, one per line. */
export function formatReplayReport({ file, calls, differences }: ReplayReport): string {
  if (differences.length === 0) return `Replayed ${calls.length} calls from ${file}: every call answered as recorded`;
  const lines = [`Replayed ${calls.length} calls from ${file}: ${differences.length} differ`];
  for (const call of differences) {
    lines.push(`  line ${call.line} ${call.method} ${call.name}: ${OUTCOME_LABELS[call.outcome]}`);
    if (call.error) {
      const { code, message } = call.error;
      lines.push(message === undefined ? `    ${code}` : `    ${code}: ${message}`);
    }
    for (const change of call.changes) {
      lines.push(`    ${change.path}: ${preview(change.recorded)} -> ${preview(change.replayed)}`);
    }
  }
  return lines.join('\n');
}
