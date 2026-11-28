import { type DirectMcpServer, type ScopeEntry } from '@frontmcp/sdk';

declare const base: DirectMcpServer;
declare const everythingButScope: Omit<DirectMcpServer, 'scope'>;
declare const scope: ScopeEntry;

// A test double or a wrapper provides the scope, e.g. its base server's.
export const double: DirectMcpServer = { ...everythingButScope, scope };
export const wrapper: DirectMcpServer = { ...everythingButScope, scope: base.scope };

// @ts-expect-error DirectMcpServer.scope is required since 1.14 (#1513)
export const withoutScope: DirectMcpServer = { ...everythingButScope };

// It is read without optional chaining.
export const subscriptions = base.scope.events?.listSubscriptions();
