/**
 * JSON-RPC error codes emitted by the dev bridge (issue #399).
 *
 * Reserved in the implementation-defined `-32099 .. -32000` range so they
 * never collide with the JSON-RPC 2.0 reserved range. Clients (Claude
 * Code, etc.) receive these in `error.code` and can render structured
 * feedback instead of sitting on an indefinite `Calling…` spinner.
 */
export const DEV_SERVER_UNREACHABLE = -32099;
export const DEV_BUFFER_FULL = -32098;
export const DEV_RELOAD_DEADLINE = -32097;

/** Human-readable label for each code. Used in the `error.message` field. */
export const DEV_ERROR_MESSAGE: Record<number, string> = {
  [DEV_SERVER_UNREACHABLE]: 'dev_server_unreachable',
  [DEV_BUFFER_FULL]: 'dev_buffer_full',
  [DEV_RELOAD_DEADLINE]: 'dev_reload_deadline',
};

/** Build a JSON-RPC error response for a given inbound request id. */
export function makeDevError(
  id: string | number | null,
  code: number,
  data?: Record<string, unknown>,
): {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: Record<string, unknown> };
} {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message: DEV_ERROR_MESSAGE[code] ?? 'dev_error',
      ...(data ? { data } : {}),
    },
  };
}
