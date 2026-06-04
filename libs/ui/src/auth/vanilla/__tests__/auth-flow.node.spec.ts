/**
 * @jest-environment node
 *
 * Exercises the SSR/node-safe branches of the vanilla helpers where `window`
 * is undefined: the `globalThis` carrier fallback and the relative-URL path
 * that returns `path?query` instead of leaking a synthesized origin.
 */
import {
  AUTH_FLOW_GLOBAL_KEY,
  getAddedItems,
  getAuthFlow,
  setAuthNavigator,
  submitExtra,
  submitFinish,
  tryGetAuthFlow,
  type AuthFlowState,
} from '../index';

const state: AuthFlowState = {
  slot: 'login',
  pendingAuthId: 'pa-1',
  csrfToken: 'csrf-1',
  submitUrl: '/mcp/oauth/callback',
  submitMethod: 'GET',
  addedItems: { envs: [{ env: 'prod' }] },
};

describe('vanilla/auth-flow (node, no window)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    expect(typeof window).toBe('undefined');
    delete (globalThis as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY];
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY];
  });

  it('reads the injected state off globalThis when window is undefined', () => {
    (globalThis as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
    expect(tryGetAuthFlow()).toEqual(state);
    expect(getAuthFlow().pendingAuthId).toBe('pa-1');
    expect(getAddedItems('envs')).toEqual([{ env: 'prod' }]);
  });

  it('builds a relative GET URL as path+query (no leaked origin)', async () => {
    (globalThis as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
    fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });

    await submitFinish({ email: 'a@b.com' }, { navigate: false });

    const [url] = fetchMock.mock.calls[0];
    // No window.location.origin → return "/path?query" rather than a fake origin.
    expect(url.startsWith('/mcp/oauth/callback?')).toBe(true);
    const search = new URLSearchParams(url.slice(url.indexOf('?')));
    expect(search.get('email')).toBe('a@b.com');
    expect(search.get('pending_auth_id')).toBe('pa-1');
  });

  it('does not navigate when window is absent even on a redirect', async () => {
    (globalThis as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
    fetchMock.mockResolvedValue({ redirected: true, url: 'https://app/cb?code=1', ok: true });
    // navigate defaults to false when there is no window; must not throw.
    await expect(submitFinish({ email: 'a@b.com' })).resolves.toBeDefined();
  });

  it('the DEFAULT navigator is a no-op when window is absent (explicit navigate)', async () => {
    // Reset to the built-in default navigator, then force navigate:true on a
    // redirect. With no window the default navigator must safely no-op.
    setAuthNavigator();
    (globalThis as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
    fetchMock.mockResolvedValue({ redirected: true, url: 'https://app/cb?code=1', ok: true });
    await expect(submitFinish({ email: 'a@b.com' }, { navigate: true })).resolves.toBeDefined();
  });

  it('submitExtra POSTs an absolute body using the explicit state', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    });
    const res = await submitExtra('envs:add', { env: 'prod' }, { ...state, extraUrl: 'https://mcp/extra' });
    expect(res.ok).toBe(true);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mcp/extra');
  });

  it('throws when global fetch is unavailable (POST path)', async () => {
    (globalThis as unknown as { fetch?: unknown }).fetch = undefined;
    await expect(submitExtra('envs:add', { env: 'prod' }, { ...state, submitMethod: 'POST' })).rejects.toThrow(
      /fetch is unavailable/,
    );
  });
});
