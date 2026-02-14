// auth/session/index.ts

// Transport session manager
export { TransportSessionManager, InMemorySessionStore } from './transport-session.manager';

// Session store factory
export {
  createSessionStore,
  createSessionStoreSync,
  createPubsubStore,
  createSqliteSessionStore,
} from './session-store.factory';

// Session service
export { SessionService } from './session.service';

// Session records
export { Session, SessionView } from './record/session.base';
export type { BaseCreateCtx, SessionUser, SessionClaims } from './record/session.base';
export { McpSession } from './record/session.mcp';

// Session ID utilities
export {
  createSessionId,
  parseSessionHeader,
  decryptPublicSession,
  generateSessionCookie,
  extractSessionFromCookie,
  updateSessionPayload,
  getSessionClientInfo,
} from './utils/session-id.utils';
export type { CreateSessionOptions } from './utils/session-id.utils';
