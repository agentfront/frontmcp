import type { JSONRPCResponse } from '../client/mcp-test-client.types';

/** The calls a recording holds. */
export const REPLAYED_METHODS = ['tools/call', 'resources/read', 'prompts/get'] as const;

export type ReplayedMethod = (typeof REPLAYED_METHODS)[number];

/** Why a call failed: a tool error answer's `_meta.code`, or a JSON-RPC error code, and the message. */
export interface ReplayError {
  code: string | number;
  /** A replayed error's message; a recording keeps only a public error's. */
  message?: string;
}

/** A call of a `CallRecorderPlugin` recording: what was asked, and the answer or error the client received. */
export interface RecordedCall {
  method: ReplayedMethod;
  name: string;
  input?: Record<string, unknown>;
  answer?: unknown;
  error?: ReplayError;
  session?: string;
  client?: { name: string; version: string };
}

export type ReplayedAnswer = { answer: unknown } | { error: ReplayError };

/** `same`, a `changed` answer or error code, a `new-error` where the recording answered, or a `gone-error`. */
export type ReplayOutcome = 'same' | 'changed' | 'new-error' | 'gone-error';

export interface ReplayChange {
  /** Dot path into the answer (`structuredContent.price`), through JSON text too (`content.0.text.price`). */
  path: string;
  recorded: unknown;
  replayed: unknown;
}

export interface CallComparison {
  outcome: ReplayOutcome;
  changes: ReplayChange[];
  /** The error the replay got (`new-error`, `changed`, `same`), or the recording had (`gone-error`). */
  error?: ReplayError;
}

export interface CompareOptions {
  /**
   * Paths not compared: dot paths into the answer where `*` is one key and `**` any number, e.g. `**.generatedAt`,
   * or `error.message` for the message of an error.
   */
  ignore?: readonly string[];
}

const REDACTED = '[REDACTED]';
const MCP_ERROR_PREFIX = /^MCP error -?\d+: /;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The code of a tool error answer the server formatted (it has `_meta.errorId`), not one the tool returned. */
function serverErrorCodeOf(result: unknown): string | undefined {
  const meta = isRecord(result) && result['isError'] === true ? result['_meta'] : undefined;
  if (!isRecord(meta) || typeof meta['errorId'] !== 'string') return undefined;
  return typeof meta['code'] === 'string' ? meta['code'] : undefined;
}

function textOf(result: unknown): string {
  const content = isRecord(result) && Array.isArray(result['content']) ? result['content'] : [];
  return content.map((block: unknown) => (isRecord(block) ? String(block['text'] ?? '') : '')).join('\n');
}

/** The answer of a replayed call, or its error: a JSON-RPC error, or a tool error answer the server formatted. */
export function replayedAnswerOf(response: JSONRPCResponse): ReplayedAnswer {
  if (response.error) {
    return { error: { code: response.error.code, message: response.error.message.replace(MCP_ERROR_PREFIX, '') } };
  }
  const code = serverErrorCodeOf(response.result);
  return code === undefined ? { answer: response.result } : { error: { code, message: textOf(response.result) } };
}

/** How a replayed call compares with its recording. */
export function compareCall(
  recorded: RecordedCall,
  replayed: ReplayedAnswer,
  options: CompareOptions = {},
): CallComparison {
  const ignore = (options.ignore ?? []).map((pattern) => pattern.split('.'));
  if (recorded.error && 'error' in replayed) {
    const changes = errorChanges(recorded.error, replayed.error).filter(
      ({ path }) => !ignore.some((pattern) => matchesPath(pattern, path.split('.'))),
    );
    return { outcome: changes.length > 0 ? 'changed' : 'same', changes, error: replayed.error };
  }
  if (recorded.error) return { outcome: 'gone-error', changes: [], error: recorded.error };
  if ('error' in replayed) return { outcome: 'new-error', changes: [], error: replayed.error };
  const changes: ReplayChange[] = [];
  collectChanges(recorded.answer, replayed.answer, [], ignore, changes);
  return { outcome: changes.length > 0 ? 'changed' : 'same', changes };
}

/** Another code; or, for the same code, another message where the recording kept one (a public error's). */
function errorChanges(recorded: ReplayError, replayed: ReplayError): ReplayChange[] {
  if (recorded.code !== replayed.code)
    return [{ path: 'error.code', recorded: recorded.code, replayed: replayed.code }];
  if (recorded.message === undefined || matchesRedacted(recorded.message, replayed.message ?? '')) return [];
  return [{ path: 'error.message', recorded: recorded.message, replayed: replayed.message }];
}

/** Whether `replayed` reads as `recorded`, where each `[REDACTED]` in `recorded` stands for any text. */
function matchesRedacted(recorded: string, replayed: string): boolean {
  const [first, ...rest] = recorded.split(REDACTED);
  const last = rest.pop();
  if (last === undefined) return recorded === replayed;
  const end = replayed.length - last.length;
  if (end < first.length || !replayed.startsWith(first) || !replayed.endsWith(last)) return false;
  let at = first.length;
  for (const part of rest) {
    const found = replayed.indexOf(part, at);
    if (found === -1 || found + part.length > end) return false;
    at = found + part.length;
  }
  return true;
}

function parsedJsonText(text: string): unknown {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function matchesPath(pattern: readonly string[], path: readonly string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [segment, ...rest] = pattern;
  if (segment === '**') return path.some((_, index) => matchesPath(rest, path.slice(index))) || matchesPath(rest, []);
  return path.length > 0 && (segment === '*' || segment === path[0]) && matchesPath(rest, path.slice(1));
}

function collectChanges(
  recorded: unknown,
  replayed: unknown,
  path: string[],
  ignore: readonly string[][],
  changes: ReplayChange[],
): void {
  if (recorded === REDACTED || ignore.some((pattern) => matchesPath(pattern, path))) return;
  if (Array.isArray(recorded) && Array.isArray(replayed)) {
    const length = Math.max(recorded.length, replayed.length);
    for (let index = 0; index < length; index++) {
      collectChanges(recorded[index], replayed[index], [...path, String(index)], ignore, changes);
    }
    return;
  }
  if (isRecord(recorded) && isRecord(replayed)) {
    for (const key of new Set([...Object.keys(recorded), ...Object.keys(replayed)])) {
      collectChanges(recorded[key], replayed[key], [...path, key], ignore, changes);
    }
    return;
  }
  if (Object.is(recorded, replayed)) return;
  if (typeof recorded === 'string' && typeof replayed === 'string') {
    const [recordedJson, replayedJson] = [parsedJsonText(recorded), parsedJsonText(replayed)];
    if (recordedJson !== undefined && replayedJson !== undefined) {
      collectChanges(recordedJson, replayedJson, path, ignore, changes);
      return;
    }
    if (matchesRedacted(recorded, replayed)) return;
  }
  changes.push({ path: path.join('.'), recorded, replayed });
}
