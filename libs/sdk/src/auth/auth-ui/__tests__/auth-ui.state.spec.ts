/**
 * Unit tests for the per-slot {@link AuthFlowState} builders (#469) — verify the
 * contract shape is built correctly from the data the flows already compute.
 */
import { AUTH_WIRE_FIELDS } from '../auth-ui.contract';
import {
  buildConsentState,
  buildErrorState,
  buildFederatedState,
  buildIncrementalState,
  buildLoginState,
} from '../auth-ui.state';

const common = {
  pendingAuthId: 'pid-123',
  submitUrl: '/oauth/callback',
  extraUrl: '/oauth/ui/extra',
  csrfToken: 'csrf-abc',
  addedItems: { add_env: [{ key: 'X' }] },
};

describe('AuthFlowState builders', () => {
  it('builds the login state with client + scopes + server-owned fields', () => {
    const s = buildLoginState(common, {
      clientId: 'client-1',
      clientName: 'Acme',
      scopes: ['read', 'write'],
      redirectUri: 'https://app/cb',
      logoUri: 'https://logo',
    });
    expect(s.slot).toBe('login');
    expect(s.pendingAuthId).toBe('pid-123');
    expect(s.clientId).toBe('client-1');
    expect(s.clientName).toBe('Acme');
    expect(s.scopes).toEqual(['read', 'write']);
    expect(s.redirectUri).toBe('https://app/cb');
    expect(s.csrfToken).toBe('csrf-abc');
    expect(s.submitUrl).toBe('/oauth/callback');
    expect(s.extraUrl).toBe('/oauth/ui/extra');
    expect(s.addedItems).toEqual({ add_env: [{ key: 'X' }] });
    expect(s.extras).toEqual({ logoUri: 'https://logo' });
  });

  it('falls back clientName to clientId when absent', () => {
    const s = buildLoginState(common, { clientId: 'cid', scopes: [], redirectUri: 'https://a' });
    expect(s.clientName).toBe('cid');
    expect(s.extras).toBeUndefined();
  });

  it('builds the consent state with tools', () => {
    const s = buildConsentState(common, {
      clientId: 'cid',
      tools: [{ id: 't1', name: 'Tool 1' }],
    });
    expect(s.slot).toBe('consent');
    expect(s.tools).toEqual([{ id: 't1', name: 'Tool 1' }]);
    expect(s.csrfToken).toBe('csrf-abc');
  });

  it('builds the federated state with providers + marker', () => {
    const s = buildFederatedState(common, {
      clientId: 'cid',
      providers: [{ id: 'github', name: 'GitHub' }],
      redirectUri: 'https://a',
    });
    expect(s.slot).toBe('federated');
    expect(s.providers).toEqual([{ id: 'github', name: 'GitHub' }]);
    expect(s.extras?.[AUTH_WIRE_FIELDS.federated]).toBe(true);
  });

  it('builds the incremental state with app marker + ids', () => {
    const s = buildIncrementalState(common, {
      appId: 'billing',
      appName: 'Billing',
      toolId: 'refund',
      redirectUri: 'https://a',
    });
    expect(s.slot).toBe('incremental');
    expect(s.extras?.[AUTH_WIRE_FIELDS.incremental]).toBe(true);
    expect(s.extras?.[AUTH_WIRE_FIELDS.appId]).toBe('billing');
    expect(s.extras?.['appName']).toBe('Billing');
    expect(s.extras?.['toolId']).toBe('refund');
  });

  it('builds the error state (with and without pending id)', () => {
    expect(buildErrorState({ error: 'boom' })).toEqual({ slot: 'error', error: 'boom' });
    expect(buildErrorState({ error: 'boom', pendingAuthId: 'pid' })).toEqual({
      slot: 'error',
      error: 'boom',
      pendingAuthId: 'pid',
    });
  });
});
