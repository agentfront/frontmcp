import type { AuthInfo } from '@frontmcp/protocol';
import type { Authorization, ServerRequest, SessionIdPayload, UserClaim } from '../common';
import type { LocalTransportAdapter } from '../transport/adapters/transport.local.adapter';
import type { StreamableHTTPServerTransport } from '@frontmcp/protocol';
import type { SSEServerTransport } from '../transport/adapters/base-sse-transport';
import type { Scope } from '../scope';

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
  }
}
