// file: libs/sdk/src/common/utils/forward-headers.utils.ts

import { globToRegex } from '@frontmcp/utils';

/** Hop-by-hop headers (RFC 9110 section 7.6.1, plus the `keep-alive` and `proxy-connection` of older proxies). */
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/** Headers that tell an upstream where the request came from: a client could forge them. */
const CLIENT_ADDRESS_HEADERS = [
  'host',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
];

/** Prefixes of header families `http.forwardHeaders` never keeps. */
const REFUSED_PREFIXES = ['proxy-', 'x-forwarded-'];

/** The headers `http.forwardHeaders` never keeps: credentials, `proxy-*`, hop-by-hop and client-address headers. */
const REFUSED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'proxy-authenticate',
  ...HOP_BY_HOP_HEADERS,
  ...CLIENT_ADDRESS_HEADERS,
];

/** Longer header names are never kept: a glob with several `*` backtracks on a long name a client picks. */
const MAX_HEADER_NAME_LENGTH = 256;

/** A header name, or a glob of one (`*` any characters, `?` one). */
export const HEADER_GLOB_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z?-]+$/i;

/** Whether FrontMCP refuses to keep a request header in `customHeaders`, whatever `http.forwardHeaders` says. */
export function isRefusedForwardHeader(name: string): boolean {
  const lowerName = name.toLowerCase();
  return REFUSED_PREFIXES.some((prefix) => lowerName.startsWith(prefix)) || REFUSED_HEADERS.includes(lowerName);
}

/** The refused headers an `http.forwardHeaders` glob would match. */
export function refusedHeadersMatchedBy(glob: string): string[] {
  const matcher = globToRegex(glob.toLowerCase());
  return REFUSED_HEADERS.filter((name) => matcher.test(name));
}

/**
 * Whether to keep a request header in `customHeaders`, from the `http.forwardHeaders` globs, matched
 * without regard to case; `undefined` when there are none. A refused header is never kept.
 */
export function createHeaderForwarder(globs: readonly string[] | undefined): ((name: string) => boolean) | undefined {
  if (!globs || globs.length === 0) return undefined;
  const matchers = globs.map((glob) => globToRegex(glob.toLowerCase()));
  return (name) => {
    if (name.length > MAX_HEADER_NAME_LENGTH) return false;
    const lowerName = name.toLowerCase();
    return !isRefusedForwardHeader(lowerName) && matchers.some((matcher) => matcher.test(lowerName));
  };
}
