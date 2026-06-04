/**
 * React context carrying the injected {@link AuthFlowState} to the auth-page
 * hooks. The provider reads the server-injected global once and exposes it (and
 * a setter so a successful `submitExtra` can refresh `addedItems` without a
 * reload).
 *
 * @packageDocumentation
 */
import { createContext, useContext } from 'react';

import type { AuthFlowState } from './contract';

/**
 * The value provided by {@link AuthPageWrapper} / {@link AuthFlowProvider}.
 */
export interface AuthFlowContextValue {
  /** The current flow state (injected by the server, mutated client-side on extra success). */
  state: AuthFlowState;
  /**
   * Merge a partial update into the in-memory flow state (e.g. refreshed
   * `addedItems` returned by a `submitExtra`). Does not touch the server.
   */
  update: (patch: Partial<AuthFlowState>) => void;
}

/**
 * Context handle. `null` outside a provider so hooks can throw a clear error.
 */
export const AuthFlowContext = createContext<AuthFlowContextValue | null>(null);

/**
 * Internal accessor used by the hooks; throws when used outside
 * {@link AuthPageWrapper} / {@link AuthFlowProvider}.
 */
export function useAuthFlowContext(): AuthFlowContextValue {
  const ctx = useContext(AuthFlowContext);
  if (!ctx) {
    throw new Error('[auth-ui] useAuthFlow* hooks must be used inside <AuthPageWrapper> / <AuthFlowProvider>');
  }
  return ctx;
}
