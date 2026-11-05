import type { AuthorizationVault } from '../../session';
import type { NormalizedProviderConfig } from '../auth-providers.registry';
import type { CredentialFactoryContext } from '../auth-providers.types';
import { LazyCredentialLoader } from '../credential-loaders/lazy-loader';

/** A provider whose factory waits until `release()`, then hands each caller a token naming its session and user. */
function heldProvider() {
  const calls: CredentialFactoryContext[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const config: NormalizedProviderConfig = {
    name: 'github',
    scope: 'session',
    loading: 'lazy',
    cacheTtl: 0,
    required: false,
    factory: async (context) => {
      calls.push(context);
      await released;
      return { type: 'bearer', token: `${context.sessionId}/${context.userSub ?? 'anonymous'}` };
    },
  };
  return { config, calls, release };
}

function callerContext(sessionId: string, userSub?: string): CredentialFactoryContext {
  return { sessionId, userSub, vault: {} as AuthorizationVault };
}

function tokenOf(resolved: Awaited<ReturnType<LazyCredentialLoader['load']>>): string | undefined {
  return resolved?.credential.type === 'bearer' ? resolved.credential.token : undefined;
}

describe('LazyCredentialLoader in-flight loads', () => {
  it('share one factory call between concurrent loads of one provider for one caller', async () => {
    const loader = new LazyCredentialLoader();
    const { config, calls, release } = heldProvider();

    const first = loader.load(config, callerContext('session-a', 'alice'));
    const second = loader.load(config, callerContext('session-a', 'alice'));
    release();

    expect((await Promise.all([first, second])).map(tokenOf)).toEqual(['session-a/alice', 'session-a/alice']);
    expect(calls).toHaveLength(1);
  });

  it('never hand one caller the credential loading for another session', async () => {
    const loader = new LazyCredentialLoader();
    const { config, calls, release } = heldProvider();

    const alice = loader.load(config, callerContext('session-a', 'alice'));
    const bob = loader.load(config, callerContext('session-b', 'bob'));
    release();

    expect((await Promise.all([alice, bob])).map(tokenOf)).toEqual(['session-a/alice', 'session-b/bob']);
    expect(calls).toHaveLength(2);
  });

  it('never hand one user the credential loading for another user of the same session id', async () => {
    const loader = new LazyCredentialLoader();
    const { config, release } = heldProvider();

    const alice = loader.load(config, callerContext('shared', 'alice'));
    const bob = loader.load(config, callerContext('shared', 'bob'));
    release();

    expect((await Promise.all([alice, bob])).map(tokenOf)).toEqual(['shared/alice', 'shared/bob']);
  });

  it('report a load in flight for its caller only, until it settles', async () => {
    const loader = new LazyCredentialLoader();
    const { config, release } = heldProvider();
    const alice = callerContext('session-a', 'alice');

    const loading = loader.load(config, alice);
    const during = [loader.isLoading('github', alice), loader.isLoading('github', callerContext('session-b', 'bob'))];
    release();
    await loading;

    expect({ during, after: loader.isLoading('github', alice) }).toEqual({ during: [true, false], after: false });
  });
});
