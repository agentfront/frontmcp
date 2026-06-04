/**
 * React hooks for FrontMCP `@AuthUi` components, built on the framework-free
 * vanilla core. They read the injected {@link AuthFlowState} via context (set
 * up by {@link AuthPageWrapper}) and expose typed accessors + submit handlers.
 *
 * @packageDocumentation
 */
import { useCallback, useState, type FormEvent } from 'react';

import { useAuthFlowContext } from './context';
import type { AuthExtraResult, AuthFlowState, AuthFormInput, AuthProvider, AuthSlot, AuthTool } from './contract';
import { submitExtra as vanillaSubmitExtra, submitFinish as vanillaSubmitFinish } from './vanilla/auth-flow';

/**
 * The shape returned by {@link useAuthFlow}: the injected state fields plus the
 * `submitFinish` handler. `submitFinish` accepts a React form event or explicit
 * data, so `<form onSubmit={submitFinish}>` works directly.
 */
export interface UseAuthFlowResult {
  /** Which page slot is being rendered. */
  slot: AuthSlot;
  /** Pending authorization id. */
  pendingAuthId?: string;
  /** OAuth client display name. */
  clientName?: string;
  /** OAuth client id. */
  clientId?: string;
  /** Requested scopes. */
  scopes: string[];
  /** Validated redirect URI. */
  redirectUri?: string;
  /** RFC 8707 resource indicator. */
  resource?: string;
  /** Error text (error slot or a failed-submit re-render). */
  error?: string;
  /** Providers offered on the federated slot. */
  providers: AuthProvider[];
  /** Tools offered on the consent slot. */
  tools: AuthTool[];
  /** Free-form slot extras the server passed through. */
  extras: Record<string, unknown>;
  /** The full raw state (escape hatch). */
  state: AuthFlowState;
  /**
   * Finish the flow. Pass nothing to submit the enclosing wrapper form, a React
   * `FormEvent` (it will `preventDefault` and serialize `event.currentTarget`),
   * or explicit form data.
   */
  submitFinish: (formOrEvent?: FormEvent<HTMLFormElement> | AuthFormInput) => Promise<Response>;
}

/** Coerce a possible React `FormEvent` into vanilla {@link AuthFormInput}. */
function normalizeFormArg(arg?: FormEvent<HTMLFormElement> | AuthFormInput): AuthFormInput | undefined {
  if (!arg) {
    return undefined;
  }
  // A synthetic event exposes `preventDefault` + `currentTarget` (the form).
  const maybeEvent = arg as FormEvent<HTMLFormElement>;
  if (typeof maybeEvent.preventDefault === 'function' && maybeEvent.currentTarget) {
    maybeEvent.preventDefault();
    return maybeEvent.currentTarget;
  }
  return arg as AuthFormInput;
}

/**
 * Primary auth hook: returns the injected flow state plus a `submitFinish`
 * handler. Everything OAuth (pending id, csrf, submit target, slot markers) is
 * already wired by the vanilla core — the developer only renders UI.
 */
export function useAuthFlow(): UseAuthFlowResult {
  const { state } = useAuthFlowContext();

  const submitFinish = useCallback(
    (formOrEvent?: FormEvent<HTMLFormElement> | AuthFormInput): Promise<Response> =>
      vanillaSubmitFinish(normalizeFormArg(formOrEvent), { state }),
    [state],
  );

  return {
    slot: state.slot,
    pendingAuthId: state.pendingAuthId,
    clientName: state.clientName,
    clientId: state.clientId,
    scopes: state.scopes ?? [],
    redirectUri: state.redirectUri,
    resource: state.resource,
    error: state.error,
    providers: state.providers ?? [],
    tools: state.tools ?? [],
    extras: state.extras ?? {},
    state,
    submitFinish,
  };
}

/**
 * Return the server-side accumulator for a named multi-step input, reactively.
 * Reads from context so it re-renders when {@link AuthPageWrapper} updates the
 * state after a successful {@link useExtraField} submit.
 */
export function useAddedItems<T = unknown>(name: string): T[] {
  const { state } = useAuthFlowContext();
  const items = state.addedItems?.[name];
  return Array.isArray(items) ? (items as T[]) : [];
}

/**
 * The handle returned by {@link useExtraField}: an `onSubmit` you bind to a
 * `<form>`, plus the last result and a pending flag.
 */
export interface UseExtraFieldResult {
  /**
   * Form submit handler. Calls `submitExtra(name, ...)`, surfaces the
   * `{ ok, error }` result, and merges any returned `addedItems` back into the
   * flow state so {@link useAddedItems} updates.
   */
  onSubmit: (formOrEvent?: FormEvent<HTMLFormElement> | AuthFormInput) => Promise<AuthExtraResult>;
  /** The most recent result (`undefined` until the first submit). */
  result?: AuthExtraResult;
  /** Whether a submit is in flight. */
  pending: boolean;
}

/**
 * Declare a custom validated field (a `@AuthExtra(name)` round-trip). Returns
 * an `onSubmit` handler for the field's form; on success it refreshes the
 * matching `addedItems` accumulator in context.
 *
 * @param name The extra's name (must match the server's `@AuthExtra(name)`).
 */
export function useExtraField(name: string): UseExtraFieldResult {
  const { state, update } = useAuthFlowContext();
  const [result, setResult] = useState<AuthExtraResult | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const onSubmit = useCallback(
    async (formOrEvent?: FormEvent<HTMLFormElement> | AuthFormInput): Promise<AuthExtraResult> => {
      const data = normalizeFormArg(formOrEvent);
      setPending(true);
      try {
        const res = await vanillaSubmitExtra(name, data, state);
        setResult(res);
        // Refresh the accumulator in context so useAddedItems re-renders.
        if (res.ok && res.addedItems) {
          update({ addedItems: res.addedItems });
        }
        return res;
      } catch (err) {
        const failure: AuthExtraResult = {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to submit field',
        };
        setResult(failure);
        return failure;
      } finally {
        setPending(false);
      }
    },
    [name, state, update],
  );

  return { onSubmit, result, pending };
}
