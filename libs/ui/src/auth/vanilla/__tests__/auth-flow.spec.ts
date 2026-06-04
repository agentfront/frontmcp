/**
 * @jest-environment jsdom
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

/** Install a flow state onto the injected global. */
function inject(state: AuthFlowState): void {
  (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
}

/** Remove the injected global. */
function clearInjected(): void {
  delete (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY];
}

const baseState: AuthFlowState = {
  slot: 'login',
  pendingAuthId: 'pa-123',
  clientName: 'Acme CLI',
  clientId: 'client-abc',
  scopes: ['read', 'write'],
  redirectUri: 'https://app.example.com/cb',
  csrfToken: 'csrf-xyz',
  submitUrl: 'https://mcp.example.com/oauth/callback',
  submitMethod: 'GET',
  addedItems: { envs: [{ env: 'prod' }, { env: 'staging' }] },
};

describe('vanilla/auth-flow', () => {
  let fetchMock: jest.Mock;
  let navigateMock: jest.Mock;

  beforeEach(() => {
    clearInjected();
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    // Inject a navigator seam instead of redefining the non-configurable,
    // read-only jsdom window.location.
    navigateMock = jest.fn();
    setAuthNavigator(navigateMock);
  });

  afterEach(() => {
    clearInjected();
    setAuthNavigator();
    jest.restoreAllMocks();
  });

  describe('getAuthFlow / tryGetAuthFlow', () => {
    it('returns the injected state', () => {
      inject(baseState);
      expect(getAuthFlow()).toEqual(baseState);
      expect(getAuthFlow().clientName).toBe('Acme CLI');
    });

    it('tryGetAuthFlow returns undefined when nothing is injected', () => {
      expect(tryGetAuthFlow()).toBeUndefined();
    });

    it('tryGetAuthFlow returns undefined for a non-object global', () => {
      (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] =
        'not-an-object' as unknown as AuthFlowState;
      expect(tryGetAuthFlow()).toBeUndefined();
    });

    it('getAuthFlow throws a helpful error when not injected', () => {
      expect(() => getAuthFlow()).toThrow(Error);
      expect(() => getAuthFlow()).toThrow(/No injected auth flow state/);
    });
  });

  describe('getAddedItems', () => {
    it('returns the accumulator for a known name', () => {
      inject(baseState);
      expect(getAddedItems('envs')).toEqual([{ env: 'prod' }, { env: 'staging' }]);
    });

    it('returns an empty array for an unknown name', () => {
      inject(baseState);
      expect(getAddedItems('missing')).toEqual([]);
    });

    it('returns an empty array when nothing is injected', () => {
      expect(getAddedItems('envs')).toEqual([]);
    });
  });

  describe('submitFinish', () => {
    it('GETs submitUrl with pending_auth_id + csrf appended', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });

      await submitFinish({ email: 'a@b.com' }, { navigate: false });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('GET');
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/oauth/callback');
      expect(parsed.searchParams.get('email')).toBe('a@b.com');
      expect(parsed.searchParams.get('pending_auth_id')).toBe('pa-123');
      expect(parsed.searchParams.get('csrf')).toBe('csrf-xyz');
    });

    it('adds consent_submitted=1 on the consent slot and preserves repeated tools', async () => {
      inject({ ...baseState, slot: 'consent' });
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });

      // A plain record with an array value expands into repeated keys.
      await submitFinish({ tools: ['t1', 't2'] }, { navigate: false });

      const [url] = fetchMock.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.getAll('tools')).toEqual(['t1', 't2']);
      expect(parsed.searchParams.get('consent_submitted')).toBe('1');
    });

    it('POSTs a urlencoded body when submitMethod is POST', async () => {
      inject({ ...baseState, submitMethod: 'POST' });
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });

      await submitFinish({ email: 'a@b.com' }, { navigate: false });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mcp.example.com/oauth/callback');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(init.body as string);
      expect(body.get('email')).toBe('a@b.com');
      expect(body.get('pending_auth_id')).toBe('pa-123');
    });

    it('serializes a FormData (and a <form> element) input', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });

      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'email';
      input.value = 'form@b.com';
      form.appendChild(input);

      await submitFinish(form, { navigate: false });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.get('email')).toBe('form@b.com');
    });

    it('follows the redirect via the navigator when navigate is on', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: true, url: 'https://app.example.com/cb?code=xyz', ok: true });

      await submitFinish({ email: 'a@b.com' }, { navigate: true });
      expect(navigateMock).toHaveBeenCalledWith('https://app.example.com/cb?code=xyz');
    });

    it('does not navigate when the response is not a redirect', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      await submitFinish({ email: 'a@b.com' }, { navigate: true });
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('the DEFAULT navigator (window present) runs without throwing on a redirect', async () => {
      // Reset to the built-in default navigator (covers its window-present
      // branch). jsdom logs "Not implemented: navigation" — suppress that noise.
      setAuthNavigator();
      const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: true, url: 'https://app.example.com/cb?code=z', ok: true });
      await expect(submitFinish({ email: 'a@b.com' }, { navigate: true })).resolves.toBeDefined();
      warn.mockRestore();
    });

    it('does not clobber a caller-provided pending_auth_id', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });

      await submitFinish({ pending_auth_id: 'override' }, { navigate: false });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.getAll('pending_auth_id')).toEqual(['override']);
    });

    it('throws when submitUrl is missing', async () => {
      inject({ slot: 'login', pendingAuthId: 'x' });
      await expect(submitFinish({}, { navigate: false })).rejects.toThrow(Error);
      await expect(submitFinish({}, { navigate: false })).rejects.toThrow(/no submitUrl/);
    });

    it('skips nullish record values', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      await submitFinish({ a: undefined, b: null, c: 'keep' }, { navigate: false });
      const [url] = fetchMock.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.has('a')).toBe(false);
      expect(parsed.searchParams.has('b')).toBe(false);
      expect(parsed.searchParams.get('c')).toBe('keep');
    });

    it('expands array values and skips nullish elements inside an array', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      await submitFinish({ tools: ['t1', null, undefined, 't2'] } as Record<string, unknown>, { navigate: false });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.getAll('tools')).toEqual(['t1', 't2']);
    });

    it('serializes a FormData instance (array values expand, files skipped)', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      const fd = new FormData();
      fd.append('tools', 't1');
      fd.append('tools', 't2');
      // A File entry is skipped by formDataToEntries.
      fd.append('file', new Blob(['x']), 'x.txt');
      await submitFinish(fd, { navigate: false });
      const [url] = fetchMock.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.getAll('tools')).toEqual(['t1', 't2']);
      expect(parsed.searchParams.has('file')).toBe(false);
    });

    it('resolves a relative submitUrl against the document origin (GET)', async () => {
      inject({ ...baseState, submitUrl: '/mcp/oauth/callback' });
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      await submitFinish({ email: 'a@b.com' }, { navigate: false });
      const [url] = fetchMock.mock.calls[0];
      // jsdom origin is http://localhost; a relative submitUrl resolves against it.
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/mcp/oauth/callback');
      expect(parsed.searchParams.get('email')).toBe('a@b.com');
    });

    it('passes an explicit options.state instead of the injected global', async () => {
      // Nothing injected — drive purely from options.state.
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      await submitFinish({ email: 'a@b.com' }, { navigate: false, state: { ...baseState, pendingAuthId: 'explicit' } });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.get('pending_auth_id')).toBe('explicit');
    });
  });

  describe('submitExtra', () => {
    it('POSTs to submitUrl with action=<name> + control fields when no extraUrl', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true, addedItems: { envs: [{ env: 'prod' }] } }),
      });

      const res = await submitExtra('envs:add', { env: 'prod' });

      expect(res.ok).toBe(true);
      expect(res.addedItems).toEqual({ envs: [{ env: 'prod' }] });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mcp.example.com/oauth/callback');
      expect(init.method).toBe('POST');
      const body = new URLSearchParams(init.body as string);
      expect(body.get('action')).toBe('envs:add');
      expect(body.get('env')).toBe('prod');
      expect(body.get('pending_auth_id')).toBe('pa-123');
      expect(body.get('csrf')).toBe('csrf-xyz');
    });

    it('POSTs to a dedicated extraUrl WITHOUT an action field', async () => {
      inject({ ...baseState, extraUrl: 'https://mcp.example.com/oauth/extra' });
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      await submitExtra('envs:add', { env: 'prod' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mcp.example.com/oauth/extra');
      const body = new URLSearchParams(init.body as string);
      expect(body.has('action')).toBe(false);
    });

    it('surfaces a JSON validation error', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: false, error: 'env already added' }),
      });

      const res = await submitExtra('envs:add', { env: 'prod' });
      expect(res).toEqual({ ok: false, error: 'env already added', addedItems: undefined, sideEffects: undefined });
    });

    it('treats a non-JSON 2xx response as ok', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) });
      const res = await submitExtra('envs:add', { env: 'prod' });
      expect(res).toEqual({ ok: true });
    });

    it('treats a non-JSON non-2xx response as a failure with a status message', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({ ok: false, status: 422, headers: new Headers({ 'content-type': 'text/html' }) });
      const res = await submitExtra('envs:add', { env: 'prod' });
      expect(res).toEqual({ ok: false, error: 'Request failed with status 422' });
    });

    it('falls back to status when JSON parsing throws', async () => {
      inject(baseState);
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => {
          throw new Error('bad json');
        },
      });
      const res = await submitExtra('envs:add', { env: 'prod' });
      expect(res).toEqual({ ok: true });
    });

    it('throws when neither extraUrl nor submitUrl is present', async () => {
      inject({ slot: 'login', pendingAuthId: 'x' });
      await expect(submitExtra('envs:add', {})).rejects.toThrow(Error);
      await expect(submitExtra('envs:add', {})).rejects.toThrow(/no extraUrl\/submitUrl/);
    });

    it('accepts an explicit state argument instead of the injected global', async () => {
      // Nothing injected.
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });
      const res = await submitExtra('envs:add', { env: 'prod' }, baseState);
      expect(res.ok).toBe(true);
      const [, init] = fetchMock.mock.calls[0];
      expect(new URLSearchParams(init.body as string).get('pending_auth_id')).toBe('pa-123');
    });
  });

  describe('environment guards', () => {
    it('throws a clear error when global fetch is unavailable', async () => {
      inject(baseState);
      (globalThis as unknown as { fetch?: unknown }).fetch = undefined;
      await expect(submitFinish({ email: 'a@b.com' }, { navigate: false })).rejects.toThrow(Error);
      await expect(submitFinish({ email: 'a@b.com' }, { navigate: false })).rejects.toThrow(/fetch is unavailable/);
    });
  });
});
