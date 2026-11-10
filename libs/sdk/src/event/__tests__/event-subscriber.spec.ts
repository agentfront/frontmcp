import { AuthoritiesContextBuilder } from '@frontmcp/auth';

import { eventSubscriberOf } from '../event-subscriber';

const signedIn = {
  user: { sub: 'ada', iss: 'https://auth.example.com', roles: ['admin'], permissions: ['orders:read'] },
  scopes: ['orders'],
};

describe('eventSubscriberOf', () => {
  it('names a signed-in caller by issuer and subject, with what the token says about them', () => {
    expect(eventSubscriberOf(signedIn)).toEqual({
      principalKey: 'principal:https://auth.example.com#ada',
      subscriber: {
        sub: 'ada',
        iss: 'https://auth.example.com',
        roles: ['admin'],
        permissions: ['orders:read'],
        scopes: ['orders'],
        claims: signedIn.user,
      },
    });
  });

  it('names a caller whose token has no issuer by subject alone', () => {
    const identity = eventSubscriberOf({ user: { sub: 'bob' } } as never);

    expect(identity?.principalKey).toBe('principal:bob');
    expect(identity?.subscriber).toEqual({
      sub: 'bob',
      roles: [],
      permissions: [],
      scopes: [],
      claims: { sub: 'bob' },
    });
  });

  it.each([
    ['no auth', {}],
    ['an anonymous subject', { user: { sub: 'anon:6f1c' } }],
    ['an empty subject', { user: { sub: '' } }],
  ])('gives %s no identity', (_label, authInfo) => {
    expect(eventSubscriberOf(authInfo as never)).toBeUndefined();
  });

  it('resolves roles and the tenant through the claims mapping of the authorities', () => {
    const contextBuilder = new AuthoritiesContextBuilder({
      claimsMapping: { roles: 'realm.roles', tenantId: 'org_id' },
    });
    const authInfo = {
      user: { sub: 'ada', iss: 'https://auth.example.com', realm: { roles: ['editor'] }, org_id: 'acme' },
    };

    const identity = eventSubscriberOf(authInfo, contextBuilder);

    expect(identity?.principalKey).toBe('principal:https://auth.example.com#ada');
    expect(identity?.subscriber.roles).toEqual(['editor']);
    expect(identity?.subscriber.tenantId).toBe('acme');
    expect(identity?.subscriber.sub).toBe('ada');
  });

  it('leaves the tenant out when the claims mapping names none', () => {
    const identity = eventSubscriberOf(signedIn, new AuthoritiesContextBuilder({}));

    expect(identity?.subscriber).not.toHaveProperty('tenantId');
  });
});
