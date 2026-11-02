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

/** The headers `http.forwardHeaders` never keeps: credentials, `proxy-*` and hop-by-hop headers. */
const REFUSED_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'proxy-authenticate', ...HOP_BY_HOP_HEADERS];

/** A header name, or a glob of one (`*` any characters, `?` one). */
export const HEADER_GLOB_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z?-]+$/i;

/** Whether FrontMCP refuses to keep a request header in `customHeaders`, whatever `http.forwardHeaders` says. */
export function isRefusedForwardHeader(name: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.startsWith('proxy-') || REFUSED_HEADERS.includes(lowerName);
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
    const lowerName = name.toLowerCase();
    return !isRefusedForwardHeader(lowerName) && matchers.some((matcher) => matcher.test(lowerName));
  };
}
