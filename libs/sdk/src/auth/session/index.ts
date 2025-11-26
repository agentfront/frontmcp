// Legacy session exports (will be deprecated)
export { SessionService } from './session.service';
export type { CreateSessionArgs } from './session.types';
export { isSoonExpiringProvider } from './token.refresh';
export { Session } from './record/session.base';

// New transport session architecture
export * from './transport-session.types';
export { TransportSessionManager, InMemorySessionStore } from './transport-session.manager';

// Authorization store for OAuth flows
export * from './authorization.store';

// Authorization vault for stateful sessions
export * from './authorization-vault';
