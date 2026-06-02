/**
 * Tests for the local-login rendering helper (Checkpoint 3a).
 *
 * Verifies the precedence rules:
 *   1. login.render → full HTML override.
 *   2. login.fields → built-in page with custom fields.
 *   3. undefined    → unchanged default email/name page.
 */
import type { LoginConfig, LoginRenderContext } from '../../options/interfaces';
import { renderLocalLoginPage, toLoginExtraFields } from '../local-login.helper';

const baseCtx: LoginRenderContext = {
  clientId: 'client-123',
  clientName: 'Acme Client',
  scopes: ['read', 'write'],
  pendingAuthId: 'pending-abc',
  callbackPath: '/app/oauth/callback',
  fields: {},
};

describe('toLoginExtraFields', () => {
  it('returns [] when fields is undefined', () => {
    expect(toLoginExtraFields(undefined)).toEqual([]);
  });

  it('maps a fields record into an ordered field array', () => {
    const fields: LoginConfig['fields'] = {
      apiKey: { type: 'password', label: 'API Key', required: true },
      region: { type: 'select', options: [{ value: 'us', label: 'US' }] },
    };
    const out = toLoginExtraFields(fields, { apiKey: 'sk-1' });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: 'apiKey', type: 'password', required: true, value: 'sk-1' });
    expect(out[1]).toMatchObject({ name: 'region', type: 'select' });
    expect(out[1].value).toBeUndefined();
  });
});

describe('renderLocalLoginPage', () => {
  it('renders the default page (email/name) when login is undefined', () => {
    const html = renderLocalLoginPage(undefined, baseCtx);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="name"');
    expect(html).toContain('value="pending-abc"');
    expect(html).toContain('Sign In');
  });

  it('invokes login.render for a full HTML override and passes the context through', () => {
    const render = jest.fn((ctx: LoginRenderContext) => `<html>custom for ${ctx.clientName}</html>`);
    const login: LoginConfig = { render };
    const html = renderLocalLoginPage(login, baseCtx);
    expect(render).toHaveBeenCalledWith(baseCtx);
    expect(html).toBe('<html>custom for Acme Client</html>');
  });

  it('renders the built-in page with custom fields when login.fields is set', () => {
    const login: LoginConfig = {
      title: 'Sign in to Acme',
      fields: { apiKey: { type: 'password', label: 'API Key', required: true } },
    };
    const html = renderLocalLoginPage(login, baseCtx);
    expect(html).toContain('Sign in to Acme');
    expect(html).toContain('name="apiKey"');
    expect(html).toContain('type="password"');
    // Default email field replaced.
    expect(html).not.toContain('name="email"');
  });

  it('surfaces the error and pre-fills submitted values on re-render', () => {
    const login: LoginConfig = {
      fields: { username: { type: 'text', label: 'Username' } },
    };
    const html = renderLocalLoginPage({ ...login }, { ...baseCtx, error: 'Bad credentials' }, { username: 'alice' });
    expect(html).toContain('Bad credentials');
    expect(html).toContain('value="alice"');
  });

  it('falls back to ctx.logoUri when login.logoUri is not set', () => {
    const html = renderLocalLoginPage({ fields: {} }, { ...baseCtx, logoUri: 'https://cdn/logo.png' });
    expect(html).toContain('https://cdn/logo.png');
  });

  it('prefers login.logoUri over ctx.logoUri', () => {
    const html = renderLocalLoginPage(
      { logoUri: 'https://login/logo.png', fields: {} },
      { ...baseCtx, logoUri: 'https://cdn/logo.png' },
    );
    expect(html).toContain('https://login/logo.png');
    expect(html).not.toContain('https://cdn/logo.png');
  });
});
