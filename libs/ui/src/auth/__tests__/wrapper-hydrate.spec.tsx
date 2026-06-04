/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react';

import { AuthFlowProvider, AuthPageWrapper } from '../AuthPageWrapper';
import { AUTH_FLOW_GLOBAL_KEY, type AuthFlowState } from '../contract';
import { useAuthFlow } from '../hooks';
import { DEFAULT_AUTH_MOUNT_ID, mountAuthPage } from '../hydrate';

function inject(state: AuthFlowState): void {
  (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY] = state;
}
function clearInjected(): void {
  delete (window as unknown as Record<string, unknown>)[AUTH_FLOW_GLOBAL_KEY];
}

const state: AuthFlowState = {
  slot: 'consent',
  pendingAuthId: 'pa-9',
  csrfToken: 'csrf-9',
  submitUrl: '/mcp/oauth/callback',
  submitMethod: 'GET',
};

describe('AuthPageWrapper', () => {
  afterEach(clearInjected);

  it('renders an enclosing form with the submit target + control hidden fields', () => {
    const { container } = render(
      <AuthPageWrapper state={state}>
        <button type="submit">go</button>
      </AuthPageWrapper>,
    );
    const form = container.querySelector('form')!;
    expect(form).toBeTruthy();
    expect(form.getAttribute('action')).toBe('/mcp/oauth/callback');
    expect(form.getAttribute('method')).toBe('get');

    const pending = form.querySelector('input[name="pending_auth_id"]') as HTMLInputElement;
    const csrf = form.querySelector('input[name="csrf"]') as HTMLInputElement;
    const consent = form.querySelector('input[name="consent_submitted"]') as HTMLInputElement;
    expect(pending.value).toBe('pa-9');
    expect(csrf.value).toBe('csrf-9');
    expect(consent.value).toBe('1');
  });

  it('omits consent_submitted on a non-consent slot', () => {
    const { container } = render(
      <AuthPageWrapper state={{ ...state, slot: 'login' }}>
        <span>x</span>
      </AuthPageWrapper>,
    );
    expect(container.querySelector('input[name="consent_submitted"]')).toBeNull();
  });

  it('does not render a form when renderForm is false', () => {
    const { container } = render(
      <AuthPageWrapper state={state} renderForm={false}>
        <span>x</span>
      </AuthPageWrapper>,
    );
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('.frontmcp-auth-page')).toBeTruthy();
  });

  it('does not render a form when submitUrl is absent', () => {
    const { container } = render(
      <AuthPageWrapper state={{ slot: 'error', error: 'x' }}>
        <span>x</span>
      </AuthPageWrapper>,
    );
    expect(container.querySelector('form')).toBeNull();
  });

  it('applies a custom className', () => {
    const { container } = render(
      <AuthPageWrapper state={{ slot: 'error' }} renderForm={false} className="my-chrome">
        <span>x</span>
      </AuthPageWrapper>,
    );
    expect(container.querySelector('.my-chrome')).toBeTruthy();
  });

  it('AuthFlowProvider falls back to an error state when nothing is injected', () => {
    function Probe() {
      const { slot, error } = useAuthFlow();
      return (
        <span>
          {slot}:{error}
        </span>
      );
    }
    render(
      <AuthFlowProvider>
        <Probe />
      </AuthFlowProvider>,
    );
    expect(screen.getByText(/error:No authorization flow state/)).toBeTruthy();
  });
});

describe('mountAuthPage', () => {
  afterEach(clearInjected);

  function Page() {
    const { pendingAuthId } = useAuthFlow();
    return <span data-testid="pid">{pendingAuthId}</span>;
  }

  it('client-renders the component into the (empty) default mount node and wires the hooks', () => {
    inject(state);
    const mount = document.createElement('div');
    mount.id = DEFAULT_AUTH_MOUNT_ID;
    // The server ships an EMPTY mount node — no SSR markup to hydrate.
    document.body.appendChild(mount);

    let root!: ReturnType<typeof mountAuthPage>;
    act(() => {
      root = mountAuthPage(Page, { renderForm: false });
    });
    // createRoot rendered the component into the previously-empty node.
    expect(screen.getByTestId('pid').textContent).toBe('pa-9');
    act(() => root.unmount());
    document.body.removeChild(mount);
  });

  it('accepts an explicit (empty) container element', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);

    let root!: ReturnType<typeof mountAuthPage>;
    act(() => {
      root = mountAuthPage(Page, { container: mount, state, renderForm: false });
    });
    expect(screen.getByTestId('pid')).toBeTruthy();
    act(() => root.unmount());
    document.body.removeChild(mount);
  });

  it('throws when the container selector matches nothing', () => {
    expect(() => mountAuthPage(() => null, { container: '#does-not-exist' })).toThrow(/could not find a container/);
  });
});
