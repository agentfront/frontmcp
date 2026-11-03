import { createSharedServerNonce, verifySharedServerIdentity } from '@frontmcp/auth';

import { SharedServerIdentityError } from '../errors/shared-server.errors';
import { unixSocketFetch } from './unix-socket-fetch';

/** Where a shared server answers an identity challenge; it needs no token, since the token comes after. */
export const SHARED_IDENTIFY_PATH = '/.well-known/frontmcp-shared-server';

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

/** `refused`: something answered, but it did not prove it holds the key. */
export type IdentifyOutcome = 'verified' | 'refused' | 'unreachable';

/** Challenge whatever listens on `endpoint` with a fresh nonce, sending it nothing else. */
export async function identifySharedServer(endpoint: SharedEndpoint, proofKey: Uint8Array): Promise<IdentifyOutcome> {
  const nonce = createSharedServerNonce();
  let response: Response;
  try {
    response = await endpoint.fetch(`${endpoint.baseUrl}${SHARED_IDENTIFY_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce }),
      signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS),
    });
  } catch {
    return 'unreachable';
  }
  if (!response.ok) {
    await response.body?.cancel();
    return 'refused';
  }
  const answer = await readAnswer(response);
  const proof = typeof answer === 'object' && answer !== null ? (answer as { proof?: unknown }).proof : undefined;
  return verifySharedServerIdentity(proofKey, endpoint.id, nonce, proof) ? 'verified' : 'refused';
}

/** Challenge the endpoint before every request: a process on the port of a server that stopped never gets one. */
export function fetchAfterIdentity(endpoint: SharedEndpoint, proofKey: Uint8Array): typeof fetch {
  return async (input, init) => {
    const outcome = await identifySharedServer(endpoint, proofKey);
    if (outcome !== 'verified') throw new SharedServerIdentityError(endpoint.id);
    return endpoint.fetch(input, init);
  };
}
