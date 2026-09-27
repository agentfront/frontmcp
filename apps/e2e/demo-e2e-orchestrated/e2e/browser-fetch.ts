/**
 * `fetch` that keeps cookies the way one browser does: it sends the cookies
 * that apply to a request (host and `Path`) and keeps what responses set
 * (`Max-Age=0` removes one).
 *
 * `/oauth/authorize` gives the browser that starts a sign-in a binding cookie,
 * and `/oauth/callback` and the provider callback refuse a request without it,
 * so a spec that walks the sign-in has to carry it like a browser.
 */
interface StoredCookie {
  host: string;
  path: string;
  name: string;
  value: string;
}

const cookies = new Map<string, StoredCookie>();

function applies(cookie: StoredCookie, url: URL): boolean {
  if (cookie.host !== url.hostname) return false;
  if (cookie.path === '/' || url.pathname === cookie.path) return true;
  return url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`);
}

function keep(url: URL, response: Response): void {
  for (const setCookie of response.headers.getSetCookie()) {
    const [pair, ...attributes] = setCookie.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const attr = (key: string) =>
      attributes.find((a) => a.toLowerCase().startsWith(`${key.toLowerCase()}=`))?.split('=')[1];
    const cookie = {
      host: url.hostname,
      path: attr('Path') ?? '/',
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
    };
    const key = `${cookie.host}|${cookie.path}|${cookie.name}`;
    if (attr('Max-Age') === '0') cookies.delete(key);
    else cookies.set(key, cookie);
  }
}

/** `fetch`, with this browser's cookies. An explicit `cookie` header is sent as given. */
export async function browserFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('cookie')) {
    const header = [...cookies.values()]
      .filter((cookie) => applies(cookie, url))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    if (header) headers.set('cookie', header);
  }
  const response = await fetch(input, { ...init, headers });
  keep(url, response);
  return response;
}
