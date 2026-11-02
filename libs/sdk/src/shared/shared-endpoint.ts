import { createSharedServerNonce, verifySharedServerIdentity } from '@frontmcp/auth';

import { SharedServerIdentityError } from '../errors/shared-server.errors';
import { unixSocketFetch } from './unix-socket-fetch';

/** Where a shared server answers an identity challenge; it needs no token, since the token comes after. */
export const SHARED_IDENTIFY_PATH = '/.well-known/frontmcp-shared-server';
/** Where a session holding the token asks an older server to drain, so it can start a newer one. */
export const SHARED_DRAIN_PATH = `${SHARED_IDENTIFY_PATH}/drain`;
/** Set on a refusal from a shared server that is exiting: the session sends the request to the next server instead. */
export const SHARED_STATE_HEADER = 'x-frontmcp-shared-server';
export const SHARED_EXITING = 'exiting';
/** The longest version a shared server states. */
export const MAX_SHARED_VERSION_LENGTH = 256;

const IDENTIFY_TIMEOUT_MS = 5_000;
const MAX_ANSWER_BYTES = 1_024;

export interface SharedEndpoint {
  /** What the server's proof is bound to: `unix:<socket path>`, or `http://127.0.0.1:<port>`. */
  id: string;
  baseUrl: string;
  fetch: typeof fetch;
}

export function unixEndpoint(socketPath: string): SharedEndpoint {
  return { id: `unix:${socketPath}`, baseUrl: 'http://localhost', fetch: unixSocketFetch(socketPath) };
}

export function httpEndpoint(port: number): SharedEndpoint {
  const baseUrl = `http://127.0.0.1:${port}`;
  return { id: baseUrl, baseUrl, fetch: (input, init) => fetch(input, init) };
}

/** The answer's JSON, unless it does not say its length or is longer than a proof: it must not fill the memory. */
async function readAnswer(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? Number.NaN);
  if (!(length <= MAX_ANSWER_BYTES)) {
    await response.body?.cancel();
    return undefined;
  }
  return response.json().catch(() => undefined);
}

/**
 * `refused`: something answered, but it did not prove it holds the key; `verified` carries the version it proved.
 * `exiting`: it says it is exiting, which needs no proof, since it is sent nothing more either way.
 */
export type IdentifyResult =
  | { outcome: 'verified'; version: string }
  | { outcome: 'refused' }
  | { outcome: 'exiting' }
  | { outcome: 'unreachable' };

/** A version a shared server states: printable ASCII, since sessions and servers write it to their logs. */
export function isSharedVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[\x20-\x7e]+$/.test(value) && value.length <= MAX_SHARED_VERSION_LENGTH;
}

/** Challenge whatever listens on `endpoint` with a fresh nonce, sending it nothing else. */
export async function identifySharedServer(
  endpoint: SharedEndpoint,
  proofKey: Uint8Array,
  timeoutMs = IDENTIFY_TIMEOUT_MS,
): Promise<IdentifyResult> {
  const nonce = createSharedServerNonce();
  let response: Response;
  try {
    response = await endpoint.fetch(`${endpoint.baseUrl}${SHARED_IDENTIFY_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, IDENTIFY_TIMEOUT_MS)),
    });
  } catch {
    return { outcome: 'unreachable' };
  }
  if (!response.ok) {
    await response.body?.cancel();
    const exiting = response.status === 503 && response.headers.get(SHARED_STATE_HEADER) === SHARED_EXITING;
    return { outcome: exiting ? 'exiting' : 'refused' };
  }
  const answer = await readAnswer(response);
  const { proof, version } = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
  if (
    isSharedVersion(version) &&
    verifySharedServerIdentity(proofKey, { endpoint: endpoint.id, nonce, version }, proof)
  ) {
    return { outcome: 'verified', version };
  }
  return { outcome: 'refused' };
}

/** Challenge the endpoint before every request: a process on the port of a server that stopped never gets one. */
export function fetchAfterIdentity(endpoint: SharedEndpoint, proofKey: Uint8Array): typeof fetch {
  return async (input, init) => {
    const { outcome } = await identifySharedServer(endpoint, proofKey);
    if (outcome !== 'verified') throw new SharedServerIdentityError(endpoint.id);
    return endpoint.fetch(input, init);
  };
}

/** Ask a server, with its token, to drain for a session of `version`: `true` once it agreed, as it does for a newer one. */
export async function requestSharedServerDrain(
  server: { endpoint: SharedEndpoint; fetch: typeof fetch; token: string },
  version: string,
): Promise<boolean> {
  try {
    const response = await server.fetch(`${server.endpoint.baseUrl}${SHARED_DRAIN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ version }),
      signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status === 202;
  } catch {
    return false;
  }
}
