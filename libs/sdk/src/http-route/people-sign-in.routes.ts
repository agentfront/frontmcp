import { escapeHtml, LoopbackTokenAuth, peopleSessionCookie, type PeopleSignInRefusal } from '@frontmcp/auth';

import { parseFormBody } from '../auth/flows/form-body.utils';
import {
  getRequestBaseUrl,
  httpRespond,
  HttpRoute,
  HttpRouteContext,
  NO_STORE_HEADERS,
  type HttpOutput,
  type ServerRequest,
} from '../common';
import { SignInLockedError, SignInRefusedError } from '../errors';

export const PEOPLE_CODE_PATH = '/_frontmcp/people/code';
export const PEOPLE_LOGIN_PATH = '/_frontmcp/people/login';

const CODE = /^[A-Za-z0-9_-]{1,128}$/;
const SAME_SITE_PATH = /^\/(?![/\\])[^\s]*$/;
const PAGE_HEADERS = { ...NO_STORE_HEADERS, 'Referrer-Policy': 'no-referrer' };

function first(value: unknown): string | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === 'string' ? item : undefined;
}

/** Where to go after signing in: a path on this server, never another site. */
function nextPath(value: unknown): string {
  const path = first(value);
  return path !== undefined && SAME_SITE_PATH.test(path) ? path : '/';
}

function bearerToken(request: ServerRequest): string | undefined {
  const match = /^bearer\s+(\S+)$/i.exec(first(request.headers['authorization'])?.trim() ?? '');
  return match?.[1];
}

function clientOf(route: HttpRouteContext): string {
  return route.tryGetContext()?.metadata.clientIp ?? 'unknown';
}

function refusal(result: PeopleSignInRefusal): Error {
  return result.reason === 'locked' ? new SignInLockedError() : new SignInRefusedError();
}

function page(title: string, body: string, head = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
}

/** Trades the startup token for a one-time sign-in code, for a CLI or another local process. */
@HttpRoute({ method: 'POST', path: PEOPLE_CODE_PATH, auth: 'public' })
export class PeopleCodeRoute extends HttpRouteContext {
  handle(): HttpOutput {
    const issued = this.get(LoopbackTokenAuth).exchangeToken(bearerToken(this.request), clientOf(this));
    if (!issued.ok) throw refusal(issued);
    const { code, expiresAt } = issued;
    return httpRespond.json(
      { code, expiresAt, loginPath: `${PEOPLE_LOGIN_PATH}?code=${code}` },
      { headers: { ...NO_STORE_HEADERS } },
    );
  }
}

/** The page a sign-in link opens: it posts the code back from this origin, and signs nothing in itself. */
@HttpRoute({ method: 'GET', path: PEOPLE_LOGIN_PATH, auth: 'public' })
export class PeopleLoginPageRoute extends HttpRouteContext {
  handle(): HttpOutput {
    const code = first(this.request.query['code']);
    if (code === undefined || !CODE.test(code)) {
      return {
        kind: 'text',
        status: 400,
        body: 'This sign-in link is not valid. Ask for a new one.',
        contentType: 'text/plain; charset=utf-8',
      };
    }
    const form =
      `<form method="post" action="${PEOPLE_LOGIN_PATH}">` +
      `<input type="hidden" name="code" value="${code}">` +
      `<input type="hidden" name="next" value="${escapeHtml(nextPath(this.request.query['next']))}">` +
      '<button type="submit">Sign in</button></form>';
    return httpRespond.html(page('Sign in', form), 200, PAGE_HEADERS);
  }
}

/** Spends a one-time code for an HttpOnly, SameSite=Strict session cookie. */
@HttpRoute({ method: 'POST', path: PEOPLE_LOGIN_PATH, auth: 'public' })
export class PeopleLoginRoute extends HttpRouteContext {
  handle(): HttpOutput {
    const fields = parseFormBody(this.request.body);
    const auth = this.get(LoopbackTokenAuth);
    const session = auth.exchangeCode(first(fields['code']), clientOf(this));
    if (!session.ok) throw refusal(session);
    const next = escapeHtml(nextPath(fields['next']));
    const cookie = peopleSessionCookie(session.cookieValue, {
      path: auth.options.cookiePath,
      secure: getRequestBaseUrl(this.request).startsWith('https:'),
      maxAgeMs: auth.options.sessionTtlMs,
    });
    const signedIn = page(
      'Signed in',
      `<a href="${next}">Continue</a>`,
      `<meta http-equiv="refresh" content="0;url=${next}">`,
    );
    return { ...httpRespond.html(signedIn, 200, PAGE_HEADERS), cookies: [cookie] };
  }
}

export const PEOPLE_SIGN_IN_ROUTES = [PeopleCodeRoute, PeopleLoginPageRoute, PeopleLoginRoute];
