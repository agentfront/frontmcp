/**
 * `<AuthPageWrapper>` — outer chrome for a FrontMCP `@AuthUi` component.
 *
 * Responsibilities (client side):
 * - Reads the server-injected {@link AuthFlowState} once and exposes it via
 *   React context so the `useAuthFlow*` hooks can consume it.
 * - Provides the in-memory `update` so a successful `submitExtra` can refresh
 *   `addedItems` without a full reload.
 * - Renders children inside a `<form>` whose `action`/`method` already point at
 *   the server's submit target (and which carries the `pending_auth_id` + `csrf`
 *   hidden fields), so a no-JS submit still works.
 *
 * CSP, anti-clickjacking headers, and minting the CSRF token are the SERVER's
 * responsibility at SSR time (stage 2). The wrapper only consumes the injected
 * `csrfToken` and posts it back correctly.
 *
 * @packageDocumentation
 */
import { useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { AuthFlowContext, type AuthFlowContextValue } from './context';
import { AUTH_WIRE_FIELDS, CONSENT_SUBMITTED_VALUE, DEFAULT_SUBMIT_METHOD, type AuthFlowState } from './contract';
import { tryGetAuthFlow } from './vanilla/auth-flow';

/**
 * Props for {@link AuthPageWrapper}.
 */
export interface AuthPageWrapperProps {
  /** The developer's auth UI. */
  children: ReactNode;
  /**
   * Override the flow state instead of reading the injected global. Primarily
   * for tests and storybook; production pages omit this and let the server
   * injection drive the wrapper.
   */
  state?: AuthFlowState;
  /**
   * When false, render children WITHOUT an enclosing `<form>` (the developer
   * supplies their own forms and drives submits via the hooks). Defaults to
   * true so a no-JS finish submit works out of the box.
   */
  renderForm?: boolean;
  /** Extra class name applied to the wrapper element. */
  className?: string;
}

/**
 * Standalone provider (no chrome) — useful when the developer wants full
 * control of layout but still needs the hooks. {@link AuthPageWrapper} builds
 * on this.
 */
export function AuthFlowProvider({
  children,
  state: stateOverride,
}: {
  children: ReactNode;
  state?: AuthFlowState;
}): ReactElement {
  const injected = stateOverride ?? tryGetAuthFlow();
  const [state, setState] = useState<AuthFlowState>(
    injected ?? { slot: 'error', error: 'No authorization flow state was provided.' },
  );

  const value = useMemo<AuthFlowContextValue>(
    () => ({
      state,
      update: (patch) => setState((prev) => ({ ...prev, ...patch })),
    }),
    [state],
  );

  return <AuthFlowContext.Provider value={value}>{children}</AuthFlowContext.Provider>;
}

/**
 * Hidden control inputs the server's callback needs on a no-JS submit. Rendered
 * inside the wrapper form so the page works even before hydration.
 */
function ControlFields({ state }: { state: AuthFlowState }): ReactElement {
  return (
    <>
      {state.pendingAuthId !== undefined && (
        <input type="hidden" name={AUTH_WIRE_FIELDS.pendingAuthId} value={state.pendingAuthId} />
      )}
      {state.csrfToken !== undefined && <input type="hidden" name={AUTH_WIRE_FIELDS.csrf} value={state.csrfToken} />}
      {state.slot === 'consent' && (
        <input type="hidden" name={AUTH_WIRE_FIELDS.consentSubmitted} value={CONSENT_SUBMITTED_VALUE} />
      )}
    </>
  );
}

/**
 * The outer chrome. By default wraps children in a `<form>` that posts to the
 * server's submit target with the control fields pre-populated.
 */
export function AuthPageWrapper({
  children,
  state: stateOverride,
  renderForm = true,
  className,
}: AuthPageWrapperProps): ReactElement {
  return (
    <AuthFlowProvider state={stateOverride}>
      <AuthPageWrapperInner renderForm={renderForm} className={className}>
        {children}
      </AuthPageWrapperInner>
    </AuthFlowProvider>
  );
}

/** Inner body that consumes the context the provider just established. */
function AuthPageWrapperInner({
  children,
  renderForm,
  className,
}: {
  children: ReactNode;
  renderForm: boolean;
  className?: string;
}): ReactElement {
  // Read the just-provided context (the provider wraps this component).
  const ctx = useAuthFlowContextSafe();
  const state = ctx?.state;

  if (!renderForm || !state?.submitUrl) {
    return <div className={className ?? 'frontmcp-auth-page'}>{children}</div>;
  }

  const method = (state.submitMethod ?? DEFAULT_SUBMIT_METHOD).toLowerCase() as 'get' | 'post';
  return (
    <div className={className ?? 'frontmcp-auth-page'}>
      <form action={state.submitUrl} method={method}>
        <ControlFields state={state} />
        {children}
      </form>
    </div>
  );
}

/** Like `useAuthFlowContext` but returns null instead of throwing (internal). */
function useAuthFlowContextSafe(): AuthFlowContextValue | null {
  return useContext(AuthFlowContext);
}
