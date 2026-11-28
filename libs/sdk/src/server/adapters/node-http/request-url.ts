// The request URL as Express reads it (the `parseurl` package): a fast split on `?` for an origin-form path, Node's
// legacy `url.parse()` otherwise, cached on the request under the same `_parsedUrl` key, so Express's own helpers
// (finalhandler) reuse it.
import * as nodeUrl from 'node:url';

// The class of what `url.parse()` returns, which Node exports but its types leave out
const LegacyUrl = (nodeUrl as unknown as { Url: new () => ParsedUrl }).Url;

interface ParsedUrl {
  pathname?: string | null;
  query?: string | null;
  search?: string | null;
  path?: string | null;
  href?: string;
  _raw?: string;
}

interface UrlCarrier {
  url?: string;
  _parsedUrl?: ParsedUrl;
}

export function parseRequestUrl(req: UrlCarrier): ParsedUrl | undefined {
  const url = req.url;
  if (url === undefined) return undefined;
  const cached = req._parsedUrl;
  if (typeof cached === 'object' && cached !== null && cached instanceof LegacyUrl && cached._raw === url) {
    return cached;
  }
  const parsed = fastParse(url);
  parsed._raw = url;
  return (req._parsedUrl = parsed);
}

/** `parseurl(req).pathname`, as Express's `req.path` returns it. */
export function pathnameOf(req: UrlCarrier): string | null | undefined {
  return parseRequestUrl(req)?.pathname;
}

function fastParse(str: string): ParsedUrl {
  if (typeof str !== 'string' || str.charCodeAt(0) !== 0x2f) {
    // Express parses a URL that is not origin-form with url.parse()
    return nodeUrl.parse(str) as unknown as ParsedUrl;
  }
  let pathname = str;
  let query: string | null = null;
  let search: string | null = null;
  for (let i = 1; i < str.length; i++) {
    switch (str.charCodeAt(i)) {
      case 0x3f:
        if (search === null) {
          pathname = str.substring(0, i);
          query = str.substring(i + 1);
          search = str.substring(i);
        }
        break;
      case 0x09:
      case 0x0a:
      case 0x0c:
      case 0x0d:
      case 0x20:
      case 0x23:
      case 0xa0:
      case 0xfeff:
        return nodeUrl.parse(str) as unknown as ParsedUrl;
    }
  }
  const url = new LegacyUrl();
  url.path = str;
  url.href = str;
  url.pathname = pathname;
  if (search !== null) {
    url.query = query;
    url.search = search;
  }
  return url;
}
