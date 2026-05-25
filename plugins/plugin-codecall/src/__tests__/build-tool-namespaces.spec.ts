// file: libs/plugins/src/codecall/__tests__/build-tool-namespaces.spec.ts

import { buildToolNamespaces, type NamespacedCallTool } from '../utils/build-tool-namespaces';

describe('buildToolNamespaces', () => {
  describe('happy path', () => {
    it('produces a namespaced callable for a dotted tool name', async () => {
      const calls: Array<{ name: string; input: unknown }> = [];
      const callTool: NamespacedCallTool = async (name, input) => {
        calls.push({ name, input });
        return { ok: true };
      };

      const { namespaces, skipped } = buildToolNamespaces([{ name: 'acme.getUser' }], callTool);

      expect(skipped).toEqual([]);
      expect(namespaces).toHaveProperty('acme.getUser');

      const result = await namespaces['acme']['getUser']({ id: '42' });

      expect(result).toEqual({ ok: true });
      expect(calls).toEqual([{ name: 'acme.getUser', input: { id: '42' } }]);
    });

    it('groups multiple methods under the same namespace', async () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces, skipped } = buildToolNamespaces(
        [{ name: 'acme.getUser' }, { name: 'acme.listUsers' }, { name: 'acme.updateUser' }],
        callTool,
      );

      expect(skipped).toEqual([]);
      expect(Object.keys(namespaces)).toEqual(['acme']);
      expect(Object.keys(namespaces['acme'])).toEqual(['getUser', 'listUsers', 'updateUser']);
    });

    it('separates different namespaces', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces } = buildToolNamespaces(
        [{ name: 'acme.getUser' }, { name: 'billing.getInvoice' }, { name: 'audit.recordEvent' }],
        callTool,
      );

      expect(Object.keys(namespaces).sort()).toEqual(['acme', 'audit', 'billing']);
      expect(typeof namespaces['acme']['getUser']).toBe('function');
      expect(typeof namespaces['billing']['getInvoice']).toBe('function');
      expect(typeof namespaces['audit']['recordEvent']).toBe('function');
    });

    it('forwards the call options argument to callTool', async () => {
      let captured: { name?: string; input?: unknown; options?: unknown } = {};
      const callTool: NamespacedCallTool = async (name, input, options) => {
        captured = { name, input, options };
        return null;
      };

      const { namespaces } = buildToolNamespaces([{ name: 'acme.getUser' }], callTool);
      await namespaces['acme']['getUser']({ id: '1' }, { throwOnError: false });

      expect(captured).toEqual({
        name: 'acme.getUser',
        input: { id: '1' },
        options: { throwOnError: false },
      });
    });

    it('propagates errors thrown by callTool', async () => {
      const callTool: NamespacedCallTool = async () => {
        throw new Error('upstream failed');
      };

      const { namespaces } = buildToolNamespaces([{ name: 'acme.getUser' }], callTool);

      await expect(namespaces['acme']['getUser']({ id: '1' })).rejects.toThrow('upstream failed');
    });

    it('accepts tools that expose extra fields beyond name', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const tools = [{ name: 'acme.ping', description: 'health', extra: { foo: 1 } }];

      const { namespaces, skipped } = buildToolNamespaces(tools, callTool);

      expect(skipped).toEqual([]);
      expect(namespaces['acme']['ping']).toBeDefined();
    });

    it('returns an empty result when the input list is empty', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces, skipped } = buildToolNamespaces([], callTool);

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([]);
    });
  });

  describe('skip reasons', () => {
    it('skips tools whose name does not contain a dot', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces, skipped } = buildToolNamespaces(
        [{ name: 'codecall:execute' }, { name: 'plain' }, { name: 'with_underscore' }],
        callTool,
      );

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'codecall:execute', reason: 'no-namespace-prefix' },
        { name: 'plain', reason: 'no-namespace-prefix' },
        { name: 'with_underscore', reason: 'no-namespace-prefix' },
      ]);
    });

    it('skips tools whose name starts with a dot', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { skipped } = buildToolNamespaces([{ name: '.leading' }], callTool);

      expect(skipped).toEqual([{ name: '.leading', reason: 'no-namespace-prefix' }]);
    });

    it('skips tools whose name ends with a dot', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { skipped } = buildToolNamespaces([{ name: 'trailing.' }], callTool);

      expect(skipped).toEqual([{ name: 'trailing.', reason: 'no-namespace-prefix' }]);
    });

    it('skips tools with a non-identifier namespace prefix', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces, skipped } = buildToolNamespaces(
        [
          { name: 'acme-api.getUser' }, // dash
          { name: '1acme.getUser' }, // leading digit
          { name: 'acme api.getUser' }, // space
        ],
        callTool,
      );

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'acme-api.getUser', reason: 'invalid-identifier' },
        { name: '1acme.getUser', reason: 'invalid-identifier' },
        { name: 'acme api.getUser', reason: 'invalid-identifier' },
      ]);
    });

    it('skips tools with a non-identifier method suffix', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces, skipped } = buildToolNamespaces(
        [
          { name: 'acme.get-user' }, // dash in method
          { name: 'acme.users.list' }, // additional dot → suffix not a single identifier
          { name: 'acme.7th' }, // leading digit
        ],
        callTool,
      );

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'acme.get-user', reason: 'invalid-identifier' },
        { name: 'acme.users.list', reason: 'invalid-identifier' },
        { name: 'acme.7th', reason: 'invalid-identifier' },
      ]);
    });

    it('skips tools whose prefix collides with a reserved global', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const { namespaces, skipped } = buildToolNamespaces(
        [
          { name: 'console.log' },
          { name: 'Math.pow' },
          { name: 'JSON.parse' },
          { name: 'globalThis.bad' },
          { name: 'callTool.invoke' },
        ],
        callTool,
      );

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'console.log', reason: 'reserved-namespace' },
        { name: 'Math.pow', reason: 'reserved-namespace' },
        { name: 'JSON.parse', reason: 'reserved-namespace' },
        { name: 'globalThis.bad', reason: 'reserved-namespace' },
        { name: 'callTool.invoke', reason: 'reserved-namespace' },
      ]);
    });

    it('first registration wins on duplicate {ns}.{method}; later ones reported as skipped', async () => {
      const calls: string[] = [];
      const callTool: NamespacedCallTool = async (name) => {
        calls.push(name);
        return name;
      };

      const { namespaces, skipped } = buildToolNamespaces(
        [{ name: 'acme.getUser' }, { name: 'acme.getUser' }],
        callTool,
      );

      expect(Object.keys(namespaces['acme'])).toEqual(['getUser']);
      expect(skipped).toEqual([{ name: 'acme.getUser', reason: 'duplicate-method' }]);

      // The single registered method still works.
      await namespaces['acme']['getUser']();
      expect(calls).toEqual(['acme.getUser']);
    });
  });

  describe('robustness', () => {
    it('silently ignores entries with non-string or empty name', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      const tools = [
        { name: 'acme.ok' },
        { name: '' },
        { name: undefined as unknown as string },
        { name: null as unknown as string },
        { name: 123 as unknown as string },
        null as unknown as { name: string },
      ];

      const { namespaces, skipped } = buildToolNamespaces(tools, callTool);

      expect(namespaces).toEqual({ acme: expect.any(Object) });
      expect(namespaces['acme']['ok']).toBeDefined();
      // Empty / invalid entries are not skipped (with a reason) — they're just dropped.
      expect(skipped).toEqual([]);
    });

    it('uses Object.prototype.hasOwnProperty (not inherited prototype keys) for duplicate detection', () => {
      const callTool: NamespacedCallTool = async () => undefined;

      // `toString` and `constructor` are inherited on every plain object — make
      // sure they are NOT treated as already-present when used as method names.
      const { namespaces, skipped } = buildToolNamespaces(
        [{ name: 'acme.toString' }, { name: 'acme.constructor' }],
        callTool,
      );

      expect(skipped).toEqual([]);
      expect(namespaces['acme']['toString']).toBeDefined();
      expect(namespaces['acme']['constructor']).toBeDefined();
    });
  });
});
