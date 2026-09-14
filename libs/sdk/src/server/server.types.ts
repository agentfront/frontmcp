import { type AuthInfo, type StreamableHTTPServerTransport } from '@frontmcp/protocol';

import { type Authorization, type ServerRequest, type SessionIdPayload, type UserClaim } from '../common';
import { type Scope } from '../scope';
import { type SSEServerTransport } from '../transport/adapters/base-sse-transport';
import { type LocalTransportAdapter } from '../transport/adapters/transport.local.adapter';

export interface ScopedServerRequest extends ServerRequest {
  authScope: Scope;
  auth?: AuthInfo;
  authSession?: Authorization;
}

export interface AuthenticatedServerRequest extends ScopedServerRequest {
  auth: AuthInfo;
  authSession: Authorization;
}

export interface SdkAuthInfo extends AuthInfo {
  transport: LocalTransportAdapter<StreamableHTTPServerTransport | SSEServerTransport>;
}

declare module '@frontmcp/protocol' {
  export interface AuthInfo {
    token: string;
    user: UserClaim;
    sessionId: string;
    sessionIdPayload: SessionIdPayload;
    /**
     * Verified token claims, as resolved by the auth flow. Surfaced so
     * permission checks can read roles/tenancy without reaching into
     * `extra.authorization`.
     */
    claims?: Record<string, unknown>;
  }
}
