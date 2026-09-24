import { AuthoritiesContextBuilder, type AuthInfoLike } from '../authorities.context';
import { AuthoritiesEngine } from '../authorities.engine';
import { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from '../authorities.registry';

const ANONYMOUS_SUBJECT = 'anon:5b2f8c1e-0d4a-4f6b-9a3e-7c1d2e3f4a5b';

function createAuthenticatedProfileEngine(): AuthoritiesEngine {
  const profiles = new AuthoritiesProfileRegistry();
  profiles.registerAll({
    authenticated: { attributes: { conditions: [{ path: 'user.sub', op: 'exists', value: true }] } },
  });
  return new AuthoritiesEngine(profiles, new AuthoritiesEvaluatorRegistry());
}

async function evaluateAuthenticated(authInfo: Partial<AuthInfoLike>) {
  const context = new AuthoritiesContextBuilder({ claimsMapping: { roles: 'roles' } }).build(authInfo);
  const result = await createAuthenticatedProfileEngine().evaluate('authenticated', context);
  return result.granted;
}

describe('documented authenticated profile against anonymous callers', () => {
  it('denies a caller that presented no identity at all', async () => {
    const granted = await evaluateAuthenticated({});

    expect(granted).toBe(false);
  });

  it('denies an anonymous MCP 2026-07-28 caller whose identity is only an anonymous client id', async () => {
    const granted = await evaluateAuthenticated({
      token: '',
      clientId: ANONYMOUS_SUBJECT,
      extra: { user: { sub: ANONYMOUS_SUBJECT, name: 'Anonymous', scope: 'anonymous' } },
    });

    expect(granted).toBe(false);
  });

  it('denies an anonymous session whose subject is an anon: placeholder', async () => {
    const granted = await evaluateAuthenticated({
      token: '',
      clientId: ANONYMOUS_SUBJECT,
      user: { sub: ANONYMOUS_SUBJECT, name: 'Anonymous' },
      scopes: ['anonymous'],
    });

    expect(granted).toBe(false);
  });
});
