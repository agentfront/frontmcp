import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  Authorization,
  ServerRequest,
  SessionIdPayload,
  UserClaim,
} from '@frontmcp/sdk';
import { LocalTransportAdapter } from '../transport/adapters/transport.local.adapter';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '../transport/legacy/legacy.sse.tranporter';
import { Scope } from '../scope';

export interface ScopedServerRequest extends ServerRequest {
  authScope: Scope;
  auth: AuthInfo;
  authSession?: Authorization;
}

export interface AuthenticatedServerRequest extends ScopedServerRequest {
  auth: AuthInfo;
  authSession: Authorization;
}

declare module '@modelcontextprotocol/sdk/server/auth/types.js' {
  export interface AuthInfo {
    sessionId: string;
    protocol: 'sse' | 'streamable-http';
    sessionIdPayload: SessionIdPayload;
    user: UserClaim;
    transport: LocalTransportAdapter<StreamableHTTPServerTransport | SSEServerTransport>;
  }
}
