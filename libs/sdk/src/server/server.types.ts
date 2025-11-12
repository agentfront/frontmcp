import {AuthInfo} from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  Authorization,
  ServerRequest,
  SessionIdPayload,
  UserClaim,
} from '../common';
import {LocalTransportAdapter} from '../transport/adapters/transport.local.adapter';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {SSEServerTransport} from '../transport/legacy/legacy.sse.tranporter';
import {Scope} from '../scope';

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
    token: string;
    user: UserClaim;
    sessionId: string;
    sessionIdPayload: SessionIdPayload;
    transport: LocalTransportAdapter<StreamableHTTPServerTransport | SSEServerTransport>;
  }
}
