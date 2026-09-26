export interface RedirectCandidate {
  status: number;
  type?: string;
}

/**
 * Whether a `fetch` response made with `redirect: 'manual'` is a redirect. Browser runtimes return
 * an `opaqueredirect` response with status 0 and no readable `Location`, so status alone misses it.
 */
export function isRedirectResponse(response: RedirectCandidate): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}
