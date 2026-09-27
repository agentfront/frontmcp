import { randomBytes } from '@frontmcp/utils';

import { openPendingLogin, sealPendingLogin, type PendingLoginState } from '../pending-login';

describe('sealPendingLogin / openPendingLogin', () => {
  const secret = randomBytes(32);
  const state: PendingLoginState = {
    sub: 'user-nour',
    email: 'nour@example.com',
    claims: { tenant: 'acme' },
    credentials: [{ key: 'crm', secret: 'crm-secret' }],
  };

  it('round-trips a verified sign-in for the same pending authorization', () => {
    const sealed = sealPendingLogin(secret, 'pending-1', state);

    expect(sealed).not.toContain('crm-secret');
    expect(sealed).not.toContain('nour@example.com');
    expect(openPendingLogin(secret, 'pending-1', sealed)).toEqual(state);
  });

  it('refuses a sign-in sealed for another pending authorization', () => {
    const sealed = sealPendingLogin(secret, 'pending-1', state);

    expect(openPendingLogin(secret, 'pending-2', sealed)).toBeUndefined();
  });

  it('refuses a sign-in sealed with another secret', () => {
    const sealed = sealPendingLogin(randomBytes(32), 'pending-1', state);

    expect(openPendingLogin(secret, 'pending-1', sealed)).toBeUndefined();
  });

  it('refuses a tampered or malformed value', () => {
    const [iv, tag, data] = sealPendingLogin(secret, 'pending-1', state).split('.');
    const flipped = `${data.slice(0, -2)}${data.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(openPendingLogin(secret, 'pending-1', `${iv}.${tag}.${flipped}`)).toBeUndefined();
    expect(openPendingLogin(secret, 'pending-1', 'garbage')).toBeUndefined();
    expect(openPendingLogin(secret, 'pending-1', '')).toBeUndefined();
  });

  it('refuses a sealed value without a subject', () => {
    const sealed = sealPendingLogin(secret, 'pending-1', { sub: '' });

    expect(openPendingLogin(secret, 'pending-1', sealed)).toBeUndefined();
  });
});
