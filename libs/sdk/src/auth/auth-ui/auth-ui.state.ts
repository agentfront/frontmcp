/**
 * Per-slot {@link AuthFlowState} builders (#469, stage 2).
 *
 * Each builder maps the values an OAuth flow ALREADY computes for its built-in
 * page (the same inputs fed to `renderLocalLoginPage` / `buildToolConsentPage` /
 * `buildFederatedLoginPage` / `buildIncrementalAuthPage`) into the stage-1
 * contract shape, plus the server-owned `csrfToken`, `submitUrl`, `extraUrl`,
 * and accumulated `addedItems`. No PII is added — identity the user types is
 * carried by the developer's own form fields, never serialized here.
 *
 * @packageDocumentation
 */
import { AUTH_WIRE_FIELDS, type AuthFlowState, type AuthProvider, type AuthTool } from './auth-ui.contract';

/** Common server-owned fields every interactive slot needs. */
interface SlotCommon {
  pendingAuthId: string;
  /** The scope's `${fullPath}/oauth/callback` submit target. */
  submitUrl: string;
  /** The `${fullPath}/oauth/ui/extra` endpoint for `@AuthExtra` submits. */
  extraUrl: string;
  /** Minted CSRF token for this pending auth. */
  csrfToken: string;
  /** Server-side accumulators for this pending auth (keyed by extra name). */
  addedItems?: Record<string, unknown[]>;
}

/** Build the `login` slot state. */
export function buildLoginState(
  common: SlotCommon,
  data: { clientId: string; clientName?: string; scopes: string[]; redirectUri: string; logoUri?: string },
): AuthFlowState {
  return {
    slot: 'login',
    pendingAuthId: common.pendingAuthId,
    clientId: data.clientId,
    clientName: data.clientName ?? data.clientId,
    scopes: data.scopes,
    redirectUri: data.redirectUri,
    csrfToken: common.csrfToken,
    submitUrl: common.submitUrl,
    extraUrl: common.extraUrl,
    addedItems: common.addedItems,
    ...(data.logoUri ? { extras: { logoUri: data.logoUri } } : {}),
  };
}

/** Build the `consent` slot state. */
export function buildConsentState(
  common: SlotCommon,
  data: { clientId: string; clientName?: string; tools: AuthTool[]; redirectUri?: string },
): AuthFlowState {
  return {
    slot: 'consent',
    pendingAuthId: common.pendingAuthId,
    clientId: data.clientId,
    clientName: data.clientName ?? data.clientId,
    redirectUri: data.redirectUri,
    tools: data.tools,
    csrfToken: common.csrfToken,
    submitUrl: common.submitUrl,
    extraUrl: common.extraUrl,
    addedItems: common.addedItems,
  };
}

/** Build the `federated` slot state. */
export function buildFederatedState(
  common: SlotCommon,
  data: { clientId: string; clientName?: string; providers: AuthProvider[]; redirectUri: string },
): AuthFlowState {
  return {
    slot: 'federated',
    pendingAuthId: common.pendingAuthId,
    clientId: data.clientId,
    clientName: data.clientName ?? data.clientId,
    redirectUri: data.redirectUri,
    providers: data.providers,
    csrfToken: common.csrfToken,
    submitUrl: common.submitUrl,
    extraUrl: common.extraUrl,
    addedItems: common.addedItems,
    // The federated form marks itself with `federated=true`.
    extras: { [AUTH_WIRE_FIELDS.federated]: true },
  };
}

/** Build the `incremental` slot state. */
export function buildIncrementalState(
  common: SlotCommon,
  data: { appId: string; appName: string; appDescription?: string; toolId?: string; redirectUri: string },
): AuthFlowState {
  return {
    slot: 'incremental',
    pendingAuthId: common.pendingAuthId,
    redirectUri: data.redirectUri,
    csrfToken: common.csrfToken,
    submitUrl: common.submitUrl,
    extraUrl: common.extraUrl,
    addedItems: common.addedItems,
    extras: {
      [AUTH_WIRE_FIELDS.incremental]: true,
      [AUTH_WIRE_FIELDS.appId]: data.appId,
      appName: data.appName,
      appDescription: data.appDescription,
      toolId: data.toolId,
    },
  };
}

/** Build the `error` slot state (may have no pending auth yet). */
export function buildErrorState(data: { error: string; pendingAuthId?: string }): AuthFlowState {
  return {
    slot: 'error',
    error: data.error,
    ...(data.pendingAuthId ? { pendingAuthId: data.pendingAuthId } : {}),
  };
}
