/**
 * Local-login page rendering helper (Checkpoint 3a).
 *
 * Single source of truth for turning a {@link LoginConfig} + {@link LoginRenderContext}
 * into HTML, shared by the authorize flow (initial render) and the callback flow
 * (error re-render). Keeps the flows lean and the precedence rules in one place:
 *
 *   1. `login.render`  → full HTML override (caller owns the markup).
 *   2. `login.fields`  → built-in page with the custom fields REPLACING email/name.
 *   3. otherwise       → the unchanged default email/name login page.
 */

import type { LoginConfig, LoginRenderContext } from '../options/interfaces';
import { buildLoginPage, type LoginExtraField } from './templates';

/**
 * Map a {@link LoginConfig.fields} record (+ optional pre-filled values) into the
 * ordered {@link LoginExtraField} array consumed by {@link buildLoginPage}.
 */
export function toLoginExtraFields(
  fields: LoginConfig['fields'] | undefined,
  values?: Record<string, string>,
): LoginExtraField[] {
  if (!fields) return [];
  return Object.entries(fields).map(([name, def]) => ({
    name,
    type: def.type,
    label: def.label,
    required: def.required,
    placeholder: def.placeholder,
    options: def.options,
    value: values?.[name],
  }));
}

/**
 * Render the local login page for the given config + context.
 *
 * When `login` is undefined (and no values/error to pre-fill) this returns the
 * byte-for-byte default login page via {@link buildLoginPage}, preserving the
 * zero-config behavior.
 *
 * @param login  The `auth.login` config (may be undefined).
 * @param ctx    Render context (client identity, scopes, pendingAuthId, callbackPath, error).
 * @param values Optional submitted values to pre-fill on re-render (after a failed authenticate()).
 */
export function renderLocalLoginPage(
  login: LoginConfig | undefined,
  ctx: LoginRenderContext,
  values?: Record<string, string>,
): string {
  // 1. Full HTML override.
  if (login?.render) {
    return login.render(ctx);
  }

  // 2. Built-in page, optionally with custom fields.
  const extraFields = login?.fields ? toLoginExtraFields(login.fields, values) : undefined;

  return buildLoginPage({
    clientName: ctx.clientName,
    scope: ctx.scopes.join(' '),
    pendingAuthId: ctx.pendingAuthId,
    callbackPath: ctx.callbackPath,
    title: login?.title,
    subtitle: login?.subtitle,
    logoUri: login?.logoUri ?? ctx.logoUri,
    error: ctx.error,
    extraFields,
  });
}
