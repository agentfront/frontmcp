import { RawZodShape } from '../common.types';
import { z } from 'zod';

export type SessionMode = 'stateful' | 'stateless';
export type TransportIdMode = 'uuid' | 'jwt';

export type SessionOptions = {
  /**
   * Defines how the session lifecycle and nested tokens are managed.
   *
   * Modes:
   * - `'stateful'`: Session and nested tokens are stored in a server-side store (e.g., Redis).
   * - `'stateless'`: All session data (including nested tokens) is embedded within a signed/encrypted JWT.
   *
   * **Behavior:**
   * - When using `'stateful'`:
   *   - Nested OAuth tokens are **never exposed** in the JWT.
   *   - Tokens are encrypted and persisted in Redis under a session key.
   *   - The client receives only a lightweight reference (session key) instead of full credentials.
   *   - Results in smaller JWT payloads and reduces token leakage risk.
   *   - Allows seamless refresh of nested provider tokens without requiring user re-authorization.
   *   - Recommended for multi-application environments or setups using short-lived OAuth tokens.
   *
   * - When using `'stateless'`:
   *   - Stores all nested tokens directly within the JWT, enabling fully client-managed sessions.
   *   - Does **not support token refresh** — once a nested provider token expires, re-authorization is required.
   *   - Simplifies implementation but may degrade UX when tokens are short-lived.
   *   - Best suited for lightweight or single-application environments where token rotation is less critical.
   *
   * @default 'stateful'
   */
  sessionMode?: SessionMode | ((issuer: string) => Promise<SessionMode> | SessionMode);
  /**
   * Defines how the Transport ID is generated, verified, and used across sessions.
   *
   * Modes:
   * - `'uuid'`: Generates a random UUID per session.
   * - `'jwt'`: Uses a signed JWT for stateless sessions, signed with a generated session key.
   *
   * **Behavior: **
   * - When using `'jwt'`:
   *   - Requires an active Redis connection to support distributed, stateless transport sessions.
   *   - Each token is verified using a generated public key associated with the existing session.
   *   - Enables access to a streamable HTTP transport session ID.
   *   - For distributed systems, verification is optimized by checking if the session is already
   *     verified by an existing live transport ID. This allows fast validation when multiple
   *     transports are connected to a shared queue (high-availability setup).
   *   - If the JWT’s transport ID is not found on the current worker node, the system attempts
   *     to connect to the corresponding remote transport in the distributed infrastructure.
   *
   * - When using `'uuid'`:
   *   - Provides a strict, node-bound session transport (single-node mode).
   *   - Each request verifies the `Authorization` header and searches for a matching transport ID
   *     derived from the hashed authorization header and the generated transport UUID.
   *   - If no matching transport ID is found, an error (`TransportNotInitialized`) is thrown.
   *
   * @default 'uuid'
   */
  transportIdMode?: TransportIdMode | ((issuer: string) => Promise<TransportIdMode> | TransportIdMode);
};

export const sessionOptionsSchema = z.object({
  sessionMode: z.union(
    [z.literal('stateful'), z.literal('stateless'), z.function()],
  ).optional().default('stateless'),
  transportIdMode: z.union(
    [z.literal('uuid'), z.literal('jwt'), z.function()],
  ).optional().default('uuid'),
} satisfies RawZodShape<SessionOptions>);