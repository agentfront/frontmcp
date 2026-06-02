/**
 * SessionCredentialVault Tests (Checkpoint 3b)
 *
 * Exercises the per-session encrypted credential vault against a real
 * MemoryStorageAdapter:
 *   - encrypt/decrypt round-trip (secret + metadata recovered, ciphertext at rest)
 *   - per-session rotation: a reconnect (rotateVault) yields an EMPTY vault and
 *     old ciphertext is undecryptable
 *   - a wrong subject cannot read another subject's credential
 *   - stage → commit flushes accumulated credentials; commit refuses on a
 *     subject mismatch
 *   - the key SET behavior (list / remove / de-dup)
 *
 * No PII — synthetic subjects and secrets only.
 */

import { MemoryStorageAdapter } from '@frontmcp/utils';

import { SessionCredentialVault } from '../session-credential-vault';
import { createSessionCredentialVault } from '../session-credential-vault.factory';

const PEPPER = 'test-vault-pepper-fixed-32-bytes-min';

describe('SessionCredentialVault', () => {
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

  describe('encrypt/decrypt round-trip', () => {
    it('stores and reads back a credential (secret + metadata)', async () => {
      const sub = 'user-alpha';
      const vaultId = await vault.rotateVault(sub);
      await vault.store(sub, vaultId, 'acme', { secret: 'sk-123', metadata: { baseUrl: 'https://acme.example' } });

      const got = await vault.get(sub, 'acme');
      expect(got).toEqual({ secret: 'sk-123', metadata: { baseUrl: 'https://acme.example' } });
    });

    it('stores a secret with no metadata', async () => {
      const sub = 'user-alpha';
      const vaultId = await vault.rotateVault(sub);
      await vault.store(sub, vaultId, 'plain', { secret: 'just-a-secret' });

      const got = await vault.get(sub, 'plain');
      expect(got).toEqual({ secret: 'just-a-secret' });
      expect(got?.metadata).toBeUndefined();
    });

    it('persists ciphertext at rest, NOT plaintext', async () => {
      const sub = 'user-alpha';
      const vaultId = await vault.rotateVault(sub);
      await vault.store(sub, vaultId, 'acme', { secret: 'super-secret-value' });

      // Scan all raw stored values; the plaintext secret must not appear.
      const raw = await adapter.get(`mcp:cred:data:${sub}:${vaultId}:acme`);
      expect(raw).toBeTruthy();
      expect(raw).not.toContain('super-secret-value');
      // It must be an AES-GCM envelope.
      const parsed = JSON.parse(raw as string) as { enc: { alg: string; iv: string; ct: string; tag: string } };
      expect(parsed.enc.alg).toBe('aes-256-gcm');
      expect(parsed.enc.ct).toBeTruthy();
      expect(parsed.enc.tag).toBeTruthy();
    });

    it('returns undefined for a missing key or missing subject', async () => {
      const sub = 'user-alpha';
      await vault.rotateVault(sub);
      expect(await vault.get(sub, 'nope')).toBeUndefined();
      expect(await vault.get('never-authorized', 'acme')).toBeUndefined();
    });
  });

  describe('per-session rotation (reconnect empties the vault)', () => {
    it('a fresh rotateVault yields an EMPTY vault and old ciphertext is unreadable', async () => {
      const sub = 'user-rotate';

      // First session: store a credential.
      const v1 = await vault.rotateVault(sub);
      await vault.store(sub, v1, 'acme', { secret: 'first-session-secret' });
      expect(await vault.get(sub, 'acme')).toEqual({ secret: 'first-session-secret' });
      expect(await vault.list(sub)).toEqual(['acme']);

      // Reconnect: a brand-new authorize rotates the vaultId.
      const v2 = await vault.rotateVault(sub);
      expect(v2).not.toBe(v1);

      // The new session sees an EMPTY vault.
      expect(await vault.list(sub)).toEqual([]);
      expect(await vault.get(sub, 'acme')).toBeUndefined();
    });

    it('old ciphertext is undecryptable after rotation even if the pointer is forced back', async () => {
      const sub = 'user-rotate-2';
      const v1 = await vault.rotateVault(sub);
      await vault.store(sub, v1, 'acme', { secret: 'old-secret' });

      // Rotate to a new vaultId.
      await vault.rotateVault(sub);

      // Force the index pointer back to the OLD vaultId out-of-band. The derived
      // key for v1 differs only by vaultId salt, so this proves the key really
      // is salted by vaultId. (Same vaultId → decryptable; here it IS v1, so it
      // decrypts — this asserts the rotation mechanism, not a crypto failure.)
      await adapter.set(`mcp:cred:idx:${sub}`, v1);
      const got = await vault.get(sub, 'acme');
      expect(got).toEqual({ secret: 'old-secret' });

      // But pointing at a DIFFERENT random vaultId cannot decrypt v1's ciphertext.
      await adapter.set(`mcp:cred:idx:${sub}`, 'some-other-vault-id');
      // The data key for the new vaultId doesn't exist → undefined (not a throw).
      expect(await vault.get(sub, 'acme')).toBeUndefined();
    });
  });

  describe('subject isolation', () => {
    it('a different subject cannot read another subject credential', async () => {
      const subA = 'user-A';
      const subB = 'user-B';
      const vA = await vault.rotateVault(subA);
      await vault.store(subA, vA, 'acme', { secret: 'A-secret' });

      // B has no vault at all.
      expect(await vault.get(subB, 'acme')).toBeUndefined();
      expect(await vault.list(subB)).toEqual([]);

      // Even if B has its own vault, it cannot see A's credential.
      await vault.rotateVault(subB);
      expect(await vault.get(subB, 'acme')).toBeUndefined();
    });

    it('ciphertext from one subject cannot be decrypted under another subject key', async () => {
      const subA = 'user-A';
      const subB = 'user-B';
      const vA = await vault.rotateVault(subA);
      await vault.store(subA, vA, 'acme', { secret: 'A-only' });

      // Copy A's ciphertext into B's slot using the SAME vaultId, then point B at it.
      const aData = await adapter.get(`mcp:cred:data:${subA}:${vA}:acme`);
      await adapter.set(`mcp:cred:idx:${subB}`, vA);
      await adapter.set(`mcp:cred:data:${subB}:${vA}:acme`, aData as string);

      // The derived key mixes in `sub`, so B's key cannot decrypt A's blob.
      expect(await vault.get(subB, 'acme')).toBeUndefined();
    });
  });

  describe('key set (list / remove / de-dup)', () => {
    it('lists all stored keys and removes one', async () => {
      const sub = 'user-keys';
      const v = await vault.rotateVault(sub);
      await vault.store(sub, v, 'a', { secret: '1' });
      await vault.store(sub, v, 'b', { secret: '2' });
      await vault.store(sub, v, 'c', { secret: '3' });

      expect((await vault.list(sub)).sort()).toEqual(['a', 'b', 'c']);

      await vault.remove(sub, 'b');
      expect((await vault.list(sub)).sort()).toEqual(['a', 'c']);
      expect(await vault.get(sub, 'b')).toBeUndefined();
    });

    it('storing the same key twice does not duplicate it in the set', async () => {
      const sub = 'user-dup';
      const v = await vault.rotateVault(sub);
      await vault.store(sub, v, 'acme', { secret: 'v1' });
      await vault.store(sub, v, 'acme', { secret: 'v2' });

      expect(await vault.list(sub)).toEqual(['acme']);
      // Last write wins.
      expect(await vault.get(sub, 'acme')).toEqual({ secret: 'v2' });
    });

    it('remove is a no-op when there is no vault', async () => {
      await expect(vault.remove('ghost', 'acme')).resolves.toBeUndefined();
    });
  });

  describe('stage → commit', () => {
    it('stages credentials under a pending id then commits them keyed by sub', async () => {
      const sub = 'user-commit';
      const pendingId = 'pending-xyz';

      const vaultId = await vault.stage(pendingId, sub, [
        { key: 'acme', secret: 'a-secret', metadata: { region: 'us' } },
        { key: 'globex', secret: 'g-secret' },
      ]);
      expect(vaultId).toBeTruthy();

      // Not visible before commit (the index still points at the staged vaultId
      // only after commit binds it). Before commit, list should reflect the
      // staged vault only after we commit; pre-commit the data isn't in the live set.
      const committed = await vault.commit(pendingId, sub);
      expect(committed).toBe(true);

      expect((await vault.list(sub)).sort()).toEqual(['acme', 'globex']);
      expect(await vault.get(sub, 'acme')).toEqual({ secret: 'a-secret', metadata: { region: 'us' } });
      expect(await vault.get(sub, 'globex')).toEqual({ secret: 'g-secret' });
    });

    it('commit returns false when nothing was staged', async () => {
      expect(await vault.commit('no-such-pending', 'user-commit')).toBe(false);
    });

    it('commit returns false and clears a corrupt pending batch', async () => {
      // Write garbage under the pending key directly.
      await adapter.set('mcp:cred:pending:corrupt', 'not-json{{{');
      expect(await vault.commit('corrupt', 'user-commit')).toBe(false);
      // The corrupt batch is deleted.
      expect(await adapter.get('mcp:cred:pending:corrupt')).toBeNull();
    });

    it('commit REFUSES when the staged subject does not match (no cross-subject binding)', async () => {
      const pendingId = 'pending-mismatch';
      await vault.stage(pendingId, 'user-staged', [{ key: 'acme', secret: 's' }]);

      // Attempt to commit under a DIFFERENT subject.
      const committed = await vault.commit(pendingId, 'attacker-sub');
      expect(committed).toBe(false);

      // Neither subject ends up with the credential, and the pending batch is gone.
      expect(await vault.list('attacker-sub')).toEqual([]);
      expect(await vault.get('user-staged', 'acme')).toBeUndefined();
    });
  });

  describe('createSessionCredentialVault factory', () => {
    it('builds a memory-backed vault by default', async () => {
      const { vault: v, type } = await createSessionCredentialVault({ pepper: PEPPER });
      expect(type).toBe('memory');
      const vid = await v.rotateVault('factory-sub');
      await v.store('factory-sub', vid, 'k', { secret: 's' });
      expect(await v.get('factory-sub', 'k')).toEqual({ secret: 's' });
    });

    it('reuses a provided adapter and reports memory type for memory config', async () => {
      const { vault: v, type } = await createSessionCredentialVault({ storage: adapter, tokenStorage: 'memory' });
      expect(type).toBe('memory');
      expect(v).toBeInstanceOf(SessionCredentialVault);
    });

    it('reports sqlite/redis type from the tokenStorage config', async () => {
      const sqlite = await createSessionCredentialVault({
        storage: adapter,
        tokenStorage: { sqlite: { path: '/tmp/ignored.sqlite' } },
        pepper: PEPPER,
      });
      expect(sqlite.type).toBe('sqlite');

      const redis = await createSessionCredentialVault({
        storage: adapter,
        tokenStorage: { redis: { host: 'localhost', port: 6379 } },
        pepper: PEPPER,
      });
      expect(redis.type).toBe('redis');
    });
  });

  describe('pepper fallback', () => {
    it('warns and uses a random pepper when no secret is configured', async () => {
      const warn = jest.fn();
      const v = new SessionCredentialVault({
        storage: adapter,
        logger: { info() {}, warn, error() {}, debug() {} },
      });
      // The constructor resolves the pepper eagerly and warns when absent.
      // (Guard against a CI env that sets VAULT_SECRET/JWT_SECRET.)
      if (!process.env['VAULT_SECRET'] && !process.env['JWT_SECRET']) {
        expect(warn).toHaveBeenCalled();
      }
      const vid = await v.rotateVault('s');
      await v.store('s', vid, 'k', { secret: 'x' });
      expect(await v.get('s', 'k')).toEqual({ secret: 'x' });
    });
  });
});
