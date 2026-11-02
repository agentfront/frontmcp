/** The calls `CallRecorderPlugin` records. */
export const RECORDED_METHODS = ['tools/call', 'resources/read', 'prompts/get'] as const;

export type RecordedMethod = (typeof RECORDED_METHODS)[number];

/** The version of the line format below. */
export const CALL_RECORD_VERSION = 1;

/** Why a recorded call failed, as its client saw it. */
export interface CallRecordError {
  /** A tool error's `_meta.code` (`TOOL_NOT_FOUND`), or the JSON-RPC error code of a resource or prompt (`-32002`). */
  code: string | number;
  /** The error's public message. */
  message: string;
}

/** One line of a call recording: a client's call and the answer it received, redacted. */
export interface CallRecord {
  v: typeof CALL_RECORD_VERSION;
  /** When the call started (ISO 8601). */
  at: string;
  method: RecordedMethod;
  /** The tool or prompt name the client asked for, or the resource URI. */
  name: string;
  /** The arguments of a tool call or a prompt. */
  input?: Record<string, unknown>;
  /** The answer the client received, after every hook and the answer stages, when the call succeeded. */
  answer?: unknown;
  error?: CallRecordError;
  durationMs: number;
  /** The first 8 characters of the session id, as the request log shows it. */
  session?: string;
  client?: { name: string; version: string };
}
