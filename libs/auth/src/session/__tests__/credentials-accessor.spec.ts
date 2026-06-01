/**
 * CredentialsAccessorImpl Tests (Checkpoint 3b)
 *
 * Exercises the `this.credentials` accessor over a real vault:
 *   - get/list resolve the request subject and decrypt
 *   - anonymous (no sub) yields no credentials
 *   - requireConnect returns the credential when connected
 *   - requireConnect returns a signed resume URL when not connected, and the URL
 *     verifies back to { sub, key, context }
 */

import { MemoryStorageAdapter } from '@frontmcp/utils';

import { verifyCredentialResumeToken } from '../credential-resume-link';
import { CredentialsAccessorImpl } from '../credentials-accessor.impl';
import { SessionCredentialVault } from '../session-credential-vault';

const PEPPER = 'accessor-test-pepper-32-bytes-minimum';
const SIGNING_SECRET = 'accessor-signing-secret-32-bytes-min';
const BASE_PATH = 'https://host/mcp';

describe('CredentialsAccessorImpl', () => {
  let adapter: MemoryStorageAdapter;
  let vault: SessionCredentialVault;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    vault = new SessionCredentialVault({ storage: adapter, pepper: PEPPER });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  function makeAccessor(sub: string | undefined) {
    return new CredentialsAccessorImpl({
      vault,
      resolveSub: () => sub,
      signingSecret: SIGNING_SECRET,
      basePath: BASE_PATH,
    });
  }

  it('get/list decrypt credentials for the resolved subject', async () => {
    const sub = 'user-1';
    const vid = await vault.rotateVault(sub);
    await vault.store(sub, vid, 'acme', { secret: 's1', metadata: { a: 1 } });

    const accessor = makeAccessor(sub);
    expect(await accessor.get('acme')).toEqual({ secret: 's1', metadata: { a: 1 } });
    expect(await accessor.list()).toEqual(['acme']);
  });

  it('anonymous (no sub) yields no credentials', async () => {
    const sub = 'user-1';
    const vid = await vault.rotateVault(sub);
    await vault.store(sub, vid, 'acme', { secret: 's1' });

    const anon = makeAccessor(undefined);
    expect(await anon.get('acme')).toBeUndefined();
    expect(await anon.list()).toEqual([]);
  });

  it('requireConnect returns the credential when connected', async () => {
    const sub = 'user-1';
    const vid = await vault.rotateVault(sub);
    await vault.store(sub, vid, 'acme', { secret: 's1' });

    const accessor = makeAccessor(sub);
    const res = await accessor.requireConnect({ key: 'acme' });
    expect(res.connected).toBe(true);
    if (res.connected) {
      expect(res.credential).toEqual({ secret: 's1' });
    }
  });

  it('requireConnect returns a signed resume URL when NOT connected', async () => {
    const sub = 'user-1';
    await vault.rotateVault(sub); // live vault, but no 'acme' credential

    const accessor = makeAccessor(sub);
    const res = await accessor.requireConnect({ key: 'acme', context: 'res-7' });
    expect(res.connected).toBe(false);
    if (!res.connected) {
      expect(res.key).toBe('acme');
      expect(res.resumeUrl).toContain('/oauth/connect?token=');
      expect(res.message).toContain('acme');

      // The URL's token verifies back to the subject/key/context.
      const token = new URL(res.resumeUrl).searchParams.get('token')!;
      const payload = verifyCredentialResumeToken(token, SIGNING_SECRET);
      expect(payload?.sub).toBe(sub);
      expect(payload?.key).toBe('acme');
      expect(payload?.context).toBe('res-7');
    }
  });

  it('requireConnect for an anonymous request still issues a (sub-empty) signed link', async () => {
    const anon = makeAccessor(undefined);
    const res = await anon.requireConnect({ key: 'acme' });
    expect(res.connected).toBe(false);
    if (!res.connected) {
      const token = new URL(res.resumeUrl).searchParams.get('token')!;
      const payload = verifyCredentialResumeToken(token, SIGNING_SECRET);
      expect(payload?.sub).toBe('');
      expect(payload?.key).toBe('acme');
    }
  });
});
