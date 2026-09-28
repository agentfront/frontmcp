/// <reference types="jest" />
/**
 * Drive FrontMCP's built-in OAuth endpoints the way a browser and an OAuth
 * client do: plain Web `Request`s through the fetch handler, no port.
 *
 * `/oauth/provider/:providerId/callback` has a path parameter the fetch handler
 * cannot route, so {@link runProviderCallback} runs that flow directly with the
 * same request shape the Node server hands it.
 */
import 'reflect-metadata';

import { createSigninBinding } from '@frontmcp/auth';
import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { type HttpOutput } from '../../common';
import { type FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { type WebFetchHandler } from '../../transport/web-fetch-handler';
import { renderHttpOutputToWebResponse } from '../../transport/web-response.renderer';

/** Release the scopes (and their timers) of servers built for a spec. */
export async function disposeServers(servers: ReadonlyArray<{ instance: FrontMcpInstance }>): Promise<void> {
  await Promise.all(
    servers.flatMap((server) => server.instance.getScopes().map((scope) => (scope as Scope).dispose())),
  );
}

/** RFC 7636 Appendix B verifier/challenge pair. */
export const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** Build `/oauth/authorize?...` with the PKCE parameters every request needs. */
export function authorizePath(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams({
    response_type: 'code',
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: 'S256',
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/oauth/authorize?${query.toString()}`;
}

/**
 * A browser's cookies: the helpers below send the ones that apply to a request
 * (host and `Path`), and keep what each response sets (`Max-Age=0` removes).
 * Every helper uses {@link defaultBrowser} unless given another jar, so a spec
 * that walks the sign-in behaves like one browser; pass a new `CookieJar` to act
 * as a different browser.
 */
export class CookieJar {
  private readonly cookies = new Map<string, { host: string; path: string; name: string; value: string }>();

  /** The `Cookie` header for a request to `path` on `host`, or undefined when none applies. */
  header(host: string, path: string): string | undefined {
    const pathname = path.split('?')[0] || '/';
    const matching = [...this.cookies.values()].filter(
      (c) =>
        c.host === host &&
        (c.path === '/' || pathname === c.path || pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`)),
    );
    return matching.length > 0 ? matching.map((c) => `${c.name}=${c.value}`).join('; ') : undefined;
  }

  /** Keep the cookies a response to `host` sets. */
  store(host: string, response: Response): void {
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = setCookie.split(';').map((part) => part.trim());
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const attr = (key: string) =>
        attributes.find((a) => a.toLowerCase().startsWith(`${key.toLowerCase()}=`))?.split('=')[1];
      const path = attr('Path') ?? '/';
      const key = `${host}|${path}|${name}`;
      if (attr('Max-Age') === '0') this.cookies.delete(key);
      else this.cookies.set(key, { host, path, name, value });
    }
  }

  /** Forget every cookie. */
  clear(): void {
    this.cookies.clear();
  }
}

/** The browser the helpers act as by default. */
export const defaultBrowser = new CookieJar();

const signinCookies = new Map<string, string>();

/**
 * For a spec that seeds a pending authorization (or a federated session)
 * itself: give it the sign-in binding `/oauth/authorize` would, and remember
 * the cookie of the browser that holds it (see {@link signinCookie}).
 *
 * @param record - the pending authorization, or a federated session
 * @param pendingAuthId - the pending authorization's id (a federated session's `pendingAuthId`)
 */
export function bindSignin<T extends { signinBinding?: string }>(record: T, pendingAuthId: string): T {
  const binding = createSigninBinding(pendingAuthId);
  record.signinBinding = binding.hash;
  signinCookies.set(pendingAuthId, `${binding.cookieName}=${binding.value}`);
  return record;
}

/** The `Cookie` header of the browser that started the sign-in `pendingAuthId` (bound with {@link bindSignin}). */
export function signinCookie(pendingAuthId: string): string {
  const cookie = signinCookies.get(pendingAuthId);
  if (!cookie) throw new Error(`no sign-in binding for ${pendingAuthId}: call bindSignin() when seeding it`);
  return cookie;
}

/** `headers` plus the jar's `Cookie` header for `path` on `host` (an explicit `cookie` header wins). */
function withCookies(
  jar: CookieJar,
  host: string,
  path: string,
  headers: Record<string, string>,
): Record<string, string> {
  const cookie = jar.header(host, path);
  return cookie && headers['cookie'] === undefined ? { ...headers, cookie } : headers;
}

/** GET a path on `host`, as a browser navigation would (with the browser's cookies). */
export async function httpGet(
  handler: WebFetchHandler,
  pathAndQuery: string,
  host = 'localhost',
  headers: Record<string, string> = {},
  browser: CookieJar = defaultBrowser,
): Promise<Response> {
  const response = await handler(
    new Request(`http://${host}${pathAndQuery}`, {
      method: 'GET',
      headers: { host, ...withCookies(browser, host, pathAndQuery, headers) },
    }),
  );
  browser.store(host, response);
  return response;
}

/** POST an `application/x-www-form-urlencoded` body, as an HTML form or an OAuth client would. */
export async function postForm(
  handler: WebFetchHandler,
  path: string,
  form: Record<string, string | string[]>,
  host = 'localhost',
  headers: Record<string, string> = {},
  browser: CookieJar = defaultBrowser,
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  const response = await handler(
    new Request(`http://${host}${path}`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/x-www-form-urlencoded',
        ...withCookies(browser, host, path, headers),
      },
      body: body.toString(),
    }),
  );
  browser.store(host, response);
  return response;
}

/** Read a hidden (or any) input's value out of a rendered form. */
export function inputValue(html: string, name: string): string | undefined {
  const match = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1];
}

/** The `code` (and the rest of the query) a 302 carries back to the client. */
export function redirectParams(response: Response): URLSearchParams {
  const location = response.headers.get('location');
  if (!location) throw new Error(`expected a redirect, got HTTP ${response.status}`);
  return new URL(location).searchParams;
}

/** Exchange an authorization code at `/oauth/token`. */
export async function exchangeCode(
  handler: WebFetchHandler,
  params: { code: string; clientId: string; redirectUri: string },
  host = 'localhost',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await postForm(
    handler,
    '/oauth/token',
    {
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_verifier: PKCE_VERIFIER,
    },
    host,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Decode a JWT payload without verifying it (tests read what the server minted). */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Run `/oauth/provider/:providerId/callback` through its flow, exactly as the
 * Node server dispatches it (path parameter included), and render the result
 * as a Web `Response`. A GET (the provider's redirect) unless `form` is given.
 */
export async function runProviderCallback(
  scope: Scope,
  providerId: string,
  query: Record<string, string>,
  host = 'localhost',
  /** A POSTed form (the federated consent screen): sent as the parsed body the Node server hands the flow. */
  form?: Record<string, string | string[]>,
  browser: CookieJar = defaultBrowser,
): Promise<Response> {
  const path = `/oauth/provider/${providerId}/callback`;
  const search = new URLSearchParams(query).toString();
  const headers = withCookies(
    browser,
    host,
    path,
    form ? { host, 'content-type': 'application/x-www-form-urlencoded' } : { host },
  );
  const request = {
    method: form ? 'POST' : 'GET',
    path,
    url: search ? `${path}?${search}` : path,
    headers,
    query,
    params: { providerId },
    body: form,
  };
  const output = (await scope.runFlow('oauth:provider-callback', { request, response: {} } as never)) as
    | HttpOutput
    | undefined;
  const response = output ? renderHttpOutputToWebResponse(output) : undefined;
  if (!response) throw new Error('provider callback produced no response');
  browser.store(host, response);
  return response;
}

/**
 * Call a tool over MCP 2026-07-28 with a bearer token, as an MCP client would.
 * Returns the HTTP status and, when the call was served, the tool's
 * `structuredContent`.
 */
export async function callToolWithToken(
  handler: WebFetchHandler,
  name: string,
  token: string | undefined,
  host = 'localhost',
): Promise<{ status: number; wwwAuthenticate: string | null; result?: Record<string, unknown> }> {
  const response = await handler(
    new Request(`http://${host}/`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'tools/call',
        'mcp-name': name,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: {},
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: { name: 'spec-client', version: '1.0.0' },
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
  const text = await response.text();
  const wwwAuthenticate = response.headers.get('www-authenticate');
  if (response.status !== 200) return { status: response.status, wwwAuthenticate };
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  const message = JSON.parse(data ? data.slice('data:'.length) : text) as {
    result?: { structuredContent?: Record<string, unknown> };
  };
  return { status: response.status, wwwAuthenticate, result: message.result?.structuredContent };
}
