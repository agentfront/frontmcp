/**
 * @jest-environment jsdom
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

import { AuthPageWrapper } from '../AuthPageWrapper';
import { AUTH_FLOW_GLOBAL_KEY, type AuthFlowState } from '../contract';
import { useAddedItems, useAuthFlow, useExtraField } from '../hooks';
import { setAuthNavigator } from '../vanilla/auth-flow';

function inject(state: AuthFlowState): void {
  (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
}
function clearInjected(): void {
  delete (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY];
}

const state: AuthFlowState = {
  slot: 'login',
  pendingAuthId: 'pa-1',
  clientName: 'Acme CLI',
  clientId: 'c-1',
  scopes: ['read'],
  redirectUri: 'https://app/cb',
  csrfToken: 'csrf-1',
  submitUrl: 'https://mcp/oauth/callback',
  submitMethod: 'GET',
  addedItems: { envs: [{ env: 'prod' }] },
  providers: [{ id: 'github', name: 'GitHub', primary: true }],
  tools: [{ id: 't1', name: 'Tool 1' }],
  extras: { logoUri: 'https://logo' },
};

// A wrapper bound to a fixed state (avoids relying on the injected global).
function makeWrapper(s: AuthFlowState) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthPageWrapper state={s} renderForm={false}>
        {children}
      </AuthPageWrapper>
    );
  };
}

describe('react/hooks', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    clearInjected();
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    setAuthNavigator(jest.fn());
  });

  afterEach(() => {
    clearInjected();
    setAuthNavigator();
    jest.restoreAllMocks();
  });

  describe('useAuthFlow', () => {
    it('returns the injected state fields', () => {
      const { result } = renderHook(() => useAuthFlow(), { wrapper: makeWrapper(state) });
      expect(result.current.slot).toBe('login');
      expect(result.current.clientName).toBe('Acme CLI');
      expect(result.current.scopes).toEqual(['read']);
      expect(result.current.providers).toHaveLength(1);
      expect(result.current.tools).toHaveLength(1);
      expect(result.current.extras).toEqual({ logoUri: 'https://logo' });
    });

    it('reads from the injected global when no state override is given', () => {
      inject(state);
      function Wrapper({ children }: { children: ReactNode }) {
        return <AuthPageWrapper renderForm={false}>{children}</AuthPageWrapper>;
      }
      const { result } = renderHook(() => useAuthFlow(), { wrapper: Wrapper });
      expect(result.current.pendingAuthId).toBe('pa-1');
    });

    it('defaults missing array/record fields to empty', () => {
      const { result } = renderHook(() => useAuthFlow(), {
        wrapper: makeWrapper({ slot: 'error', error: 'boom' }),
      });
      expect(result.current.scopes).toEqual([]);
      expect(result.current.providers).toEqual([]);
      expect(result.current.tools).toEqual([]);
      expect(result.current.extras).toEqual({});
      expect(result.current.error).toBe('boom');
    });

    it('submitFinish serializes a form event and posts control fields', async () => {
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      const { result } = renderHook(() => useAuthFlow(), { wrapper: makeWrapper(state) });

      // Build a fake form event.
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'email';
      input.value = 'x@y.com';
      form.appendChild(input);
      const preventDefault = jest.fn();
      const evt = { preventDefault, currentTarget: form } as unknown as React.FormEvent<HTMLFormElement>;

      await act(async () => {
        await result.current.submitFinish(evt);
      });

      expect(preventDefault).toHaveBeenCalled();
      const [url] = fetchMock.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.get('email')).toBe('x@y.com');
      expect(parsed.searchParams.get('pending_auth_id')).toBe('pa-1');
      expect(parsed.searchParams.get('csrf')).toBe('csrf-1');
    });

    it('submitFinish accepts a plain data record (non-event)', async () => {
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      const { result } = renderHook(() => useAuthFlow(), { wrapper: makeWrapper(state) });
      await act(async () => {
        await result.current.submitFinish({ email: 'plain@b.com' });
      });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.get('email')).toBe('plain@b.com');
    });

    it('submitFinish accepts no argument (submits control fields only)', async () => {
      fetchMock.mockResolvedValue({ redirected: false, url: '', ok: true });
      const { result } = renderHook(() => useAuthFlow(), { wrapper: makeWrapper(state) });
      await act(async () => {
        await result.current.submitFinish();
      });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.get('pending_auth_id')).toBe('pa-1');
    });

    it('throws when used outside the provider', () => {
      // Suppress the expected React error boundary console noise.
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(() => renderHook(() => useAuthFlow())).toThrow(/must be used inside/);
      spy.mockRestore();
    });
  });

  describe('useAddedItems', () => {
    it('returns the accumulator', () => {
      const { result } = renderHook(() => useAddedItems<{ env: string }>('envs'), {
        wrapper: makeWrapper(state),
      });
      expect(result.current).toEqual([{ env: 'prod' }]);
    });

    it('returns empty for an unknown name', () => {
      const { result } = renderHook(() => useAddedItems('missing'), { wrapper: makeWrapper(state) });
      expect(result.current).toEqual([]);
    });
  });

  describe('useExtraField', () => {
    it('calls submitExtra and surfaces { ok } + refreshes addedItems', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true, addedItems: { envs: [{ env: 'prod' }, { env: 'dev' }] } }),
      });

      // Render a combined component so useExtraField + useAddedItems share context.
      function Combined() {
        const envs = useAddedItems<{ env: string }>('envs');
        const add = useExtraField('envs:add');
        return (
          <div>
            <span data-testid="count">{envs.length}</span>
            <span data-testid="result">{add.result ? String(add.result.ok) : 'none'}</span>
            <span data-testid="pending">{String(add.pending)}</span>
            <button onClick={() => void add.onSubmit({ env: 'dev' })}>add</button>
          </div>
        );
      }

      render(
        <AuthPageWrapper state={state} renderForm={false}>
          <Combined />
        </AuthPageWrapper>,
      );

      expect(screen.getByTestId('count').textContent).toBe('1');
      expect(screen.getByTestId('result').textContent).toBe('none');

      await act(async () => {
        screen.getByText('add').click();
      });

      await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('true'));
      // addedItems refreshed in context → useAddedItems re-rendered.
      expect(screen.getByTestId('count').textContent).toBe('2');

      const [, init] = fetchMock.mock.calls[0];
      const body = new URLSearchParams(init.body as string);
      expect(body.get('action')).toBe('envs:add');
      expect(body.get('env')).toBe('dev');
    });

    it('surfaces a failure result and does not refresh items', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: false, error: 'dup' }),
      });

      const { result } = renderHook(() => useExtraField('envs:add'), { wrapper: makeWrapper(state) });
      let res: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        res = await result.current.onSubmit({ env: 'prod' });
      });
      expect(res).toMatchObject({ ok: false, error: 'dup' });
      expect(result.current.result).toMatchObject({ ok: false, error: 'dup' });
    });

    it('captures a thrown error as a failed result', async () => {
      // No submitUrl/extraUrl → vanillaSubmitExtra throws → hook converts it.
      const { result } = renderHook(() => useExtraField('envs:add'), {
        wrapper: makeWrapper({ slot: 'login', pendingAuthId: 'x' }),
      });
      let res: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        res = await result.current.onSubmit({ env: 'prod' });
      });
      expect(res?.ok).toBe(false);
      expect(res?.error).toMatch(/no extraUrl\/submitUrl/);
    });
  });
});
