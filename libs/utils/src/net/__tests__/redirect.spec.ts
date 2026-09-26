import { isRedirectResponse } from '../redirect';

describe('isRedirectResponse', () => {
  it.each([301, 302, 303, 307, 308, 399])('treats status %s as a redirect', (status) => {
    expect(isRedirectResponse({ status })).toBe(true);
  });

  it('treats an opaque redirect (status 0) as a redirect', () => {
    expect(isRedirectResponse({ status: 0, type: 'opaqueredirect' })).toBe(true);
  });

  it.each([
    [{ status: 200 }],
    [{ status: 299 }],
    [{ status: 400 }],
    [{ status: 0, type: 'error' as const }],
    [{ status: 200, type: 'basic' as const }],
  ])('does not treat %p as a redirect', (response) => {
    expect(isRedirectResponse(response)).toBe(false);
  });
});
