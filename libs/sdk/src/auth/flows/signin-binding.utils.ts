/**
 * The HTTP side of the sign-in binding (see `createSigninBinding` in
 * `@frontmcp/auth`): the cookie `/oauth/authorize` sets, and the check the
 * callbacks run before resuming a sign-in.
 */
import {
  SIGNIN_BINDING_MAX_AGE_SECONDS,
  signinBindingCookieName,
  signinBindingMatches,
  type SigninBinding,
} from '@frontmcp/auth';
import { isSecureRequest } from '@frontmcp/utils';

import { getRequestBaseUrl, ServerRequestTokens, type HttpCookie, type ServerRequest } from '../../common';

/**
 * Path of the binding cookie: `/oauth`, where the OAuth endpoints live, unless
 * the server's issuer or scope carries a path prefix, which the provider
 * callback URL (`<issuer>/oauth/provider/<id>/callback`) and the federated
 * consent form include. Then `/`, so the cookie still reaches them.
 */
export function signinCookiePath(issuer: string, scopePath: string): string {
  let issuerPath: string;
  try {
    issuerPath = new URL(issuer).pathname.replace(/\/+$/, '');
  } catch {
    return '/';
  }
  return issuerPath === '' && scopePath.replace(/\/+$/, '') === '' ? '/oauth' : '/';
}

/** Whether the browser reached this request over https (so the cookie can be `Secure`). */
function isHttps(request: ServerRequest): boolean {
  if (isSecureRequest(request as unknown as Parameters<typeof isSecureRequest>[0])) return true;
  if (getRequestBaseUrl(request).startsWith('https:')) return true;
  const webRequest = (request as unknown as Record<PropertyKey, unknown>)[ServerRequestTokens.webRequest];
  return webRequest instanceof Request && webRequest.url.startsWith('https:');
}

/** The cookie that gives the browser its binding: HttpOnly, SameSite=Lax, Secure over https. */
export function signinBindingCookie(request: ServerRequest, binding: SigninBinding, path: string): HttpCookie {
  return {
    name: binding.cookieName,
    value: binding.value,
    path,
    httpOnly: true,
    // Lax, not Strict: the upstream provider returns the browser with a
    // cross-site top-level GET, which must carry the cookie.
    sameSite: 'lax',
    secure: isHttps(request),
    maxAge: SIGNIN_BINDING_MAX_AGE_SECONDS,
  };
}

/** A `Set-Cookie` that removes the binding cookie of `pendingAuthId` once its sign-in is over. */
export function clearedSigninBindingCookie(request: ServerRequest, pendingAuthId: string, path: string): HttpCookie {
  return {
    name: signinBindingCookieName(pendingAuthId),
    value: '',
    path,
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    maxAge: 0,
  };
}

/** Whether `request` comes from the browser that started the sign-in `pendingAuthId` (its binding hash is `hash`). */
export function requestHoldsSigninBinding(
  request: ServerRequest,
  pendingAuthId: string,
  hash: string | undefined,
): boolean {
  const raw = (request.headers as Record<string, string | string[] | undefined> | undefined)?.['cookie'];
  const header = Array.isArray(raw) ? raw.join('; ') : raw;
  return signinBindingMatches(header, pendingAuthId, hash);
}

/** `output` with `cookie` added to the cookies it sets. */
export function withCookie<T extends { cookies?: HttpCookie[] }>(output: T, cookie: HttpCookie): T {
  return { ...output, cookies: [...(output.cookies ?? []), cookie] };
}

/** The error text for a sign-in resumed without its binding cookie. */
export const SIGNIN_BINDING_REFUSED =
  'This sign-in was started in another browser, or at another address. Start it again from the app.';
