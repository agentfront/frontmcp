/**
 * Stateless HTTP clients must not share Remember memory, and the key that encrypts it must
 * not be derivable from public data (GHSA-225p-f8jh-f3rh, GHSA-h6f4-jg8x-38gj).
 *
 * In stateless mode the transport injects the literal session id `__stateless__` into every
 * request (`handle.stateless-http.flow.ts`). Two consequences, one root cause — the plugin
 * treats a session identifier as both a namespace and a secret:
 *
 *  1. `buildScopePrefix` produces `remember:session:__stateless__:` for every client, so all
 *     of them read and write the same keys. One client's memory is another's.
 *  2. `deriveEncryptionKey` used the session id itself as HKDF input keying material. A
 *     session id is not secret — the client knows it and it travels in the `mcp-session-id`
 *     header — and in stateless mode it is a fixed public constant, so the encryption key is
 *     a constant anyone can recompute. Encryption at rest protects nothing against a party
 *     who can derive the key.
 *
 * The same shape appears for `user` scope with no authenticated user: everyone pooled under
 * `user:anonymous`.
 */
import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import { deriveEncryptionKey } from '../remember.crypto';
import type { RememberPluginOptions } from '../remember.types';

function createStore(): { store: RememberStoreInterface; values: Map<string, string> } {
  const values = new Map<string, string>();
  const store: RememberStoreInterface = {
    setValue: jest.fn(async (key: string, value: unknown) => {
      values.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }),
    getValue: jest.fn(async <T>(key: string, defaultValue?: T) => (values.get(key) as T | undefined) ?? defaultValue),
    delete: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    exists: jest.fn(async (key: string) => values.has(key)),
    keys: jest.fn(async (pattern?: string) => {
      const all = [...values.keys()];
      if (!pattern) return all;
      const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return all.filter((key) => regex.test(key));
    }),
    close: jest.fn(async () => {
      values.clear();
    }),
  };
  return { store, values };
}

// `skipLegacyPurge` because these tests assert on raw store keys and the migration's layout
// marker is not their subject; it is covered by remember.legacy-purge.spec.ts.
const statelessConfig = {
  type: 'memory',
  encryption: { enabled: false },
  skipLegacyPurge: true,
} as RememberPluginOptions;

function createAccessor(
  sessionId: string,
  authInfo?: Record<string, unknown>,
  shared?: ReturnType<typeof createStore>,
) {
  const backing = shared ?? createStore();
  const ctx = { sessionId, authInfo, flow: { name: 'billing:refund' } } as unknown as FrontMcpContext;
  return {
    accessor: new RememberAccessor(backing.store, ctx, statelessConfig),
    values: backing.values,
  };
}

describe('Remember — stateless isolation (GHSA-225p-f8jh-f3rh, GHSA-h6f4-jg8x-38gj)', () => {
  describe('storage namespace', () => {
    it('refuses session scope for an unauthenticated stateless request', async () => {
      const { accessor } = createAccessor('__stateless__');

      await expect(accessor.set('card', '4242', { scope: 'session' })).rejects.toThrow(/stateless/i);
    });

    it('does not let one stateless client read another stateless client value', async () => {
      // ONE backing store, so this exercises real cross-client access rather than comparing
      // key strings from two isolated maps.
      const shared = createStore();
      const writer = createAccessor('__stateless__', { extra: { sub: 'user-a' } }, shared);
      const reader = createAccessor('__stateless__', { extra: { sub: 'user-b' } }, shared);

      await writer.accessor.set('card', '4242', { scope: 'session' });

      await expect(reader.accessor.get('card', { scope: 'session' })).resolves.toBeUndefined();
      await expect(writer.accessor.get('card', { scope: 'session' })).resolves.toBe('4242');
    });

    it('keeps a colon in an identity from colliding with a colon in a key', async () => {
      // Identity `a` + key `b:c` must not land where identity `a:b` + key `c` lands.
      const shared = createStore();
      const first = createAccessor('__stateless__', { extra: { sub: 'a' } }, shared);
      const second = createAccessor('__stateless__', { extra: { sub: 'a:b' } }, shared);

      await first.accessor.set('b:c', 'first-value', { scope: 'session' });
      await second.accessor.set('c', 'second-value', { scope: 'session' });

      await expect(first.accessor.get('b:c', { scope: 'session' })).resolves.toBe('first-value');
      await expect(second.accessor.get('c', { scope: 'session' })).resolves.toBe('second-value');
    });

    it('refuses user scope when there is no authenticated user', async () => {
      const { accessor } = createAccessor('session-1');

      await expect(accessor.set('card', '4242', { scope: 'user' })).rejects.toThrow(/anonymous|authenticated/i);
    });

    it('still namespaces an ordinary session normally', async () => {
      const { accessor, values } = createAccessor('session-abc');

      await accessor.set('theme', 'dark', { scope: 'session' });

      expect([...values.keys()]).toEqual(['remember:v2:session:session-abc:theme']);
    });
  });

  describe('key derivation', () => {
    it('does not derive the session key from the session id alone', async () => {
      const original = process.env['REMEMBER_SECRET'];
      process.env['REMEMBER_SECRET'] = 'server-secret-one';
      const withFirstSecret = await deriveEncryptionKey({ type: 'session', sessionId: 'session-abc' });

      process.env['REMEMBER_SECRET'] = 'server-secret-two';
      const withSecondSecret = await deriveEncryptionKey({ type: 'session', sessionId: 'session-abc' });

      if (original === undefined) delete process.env['REMEMBER_SECRET'];
      else process.env['REMEMBER_SECRET'] = original;

      // Knowing the session id must not be enough to recompute the key.
      expect(Buffer.from(withFirstSecret)).not.toEqual(Buffer.from(withSecondSecret));
    });

    it('does not derive the tool key from the session id alone', async () => {
      const original = process.env['REMEMBER_SECRET'];
      process.env['REMEMBER_SECRET'] = 'server-secret-one';
      const first = await deriveEncryptionKey({ type: 'tool', toolName: 'billing:refund', sessionId: 'session-abc' });

      process.env['REMEMBER_SECRET'] = 'server-secret-two';
      const second = await deriveEncryptionKey({ type: 'tool', toolName: 'billing:refund', sessionId: 'session-abc' });

      if (original === undefined) delete process.env['REMEMBER_SECRET'];
      else process.env['REMEMBER_SECRET'] = original;

      expect(Buffer.from(first)).not.toEqual(Buffer.from(second));
    });

    it('still separates two sessions under the same server secret', async () => {
      const original = process.env['REMEMBER_SECRET'];
      process.env['REMEMBER_SECRET'] = 'server-secret-one';

      const a = await deriveEncryptionKey({ type: 'session', sessionId: 'session-a' });
      const b = await deriveEncryptionKey({ type: 'session', sessionId: 'session-b' });

      if (original === undefined) delete process.env['REMEMBER_SECRET'];
      else process.env['REMEMBER_SECRET'] = original;

      expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
    });
  });
});
