// file: libs/plugins/src/codecall/__tests__/build-tool-namespaces.spec.ts

import { buildToolNamespaces, wrapScriptWithToolNamespaces } from '../utils/build-tool-namespaces';

describe('buildToolNamespaces', () => {
  describe('happy path', () => {
    it('maps a dotted tool name to its namespace and method', () => {
      const { namespaces, skipped } = buildToolNamespaces([{ name: 'acme.getUser' }]);

      expect(skipped).toEqual([]);
      expect({ ...namespaces['acme'] }).toEqual({ getUser: 'acme.getUser' });
    });

    it('groups multiple methods under the same namespace', () => {
      const { namespaces, skipped } = buildToolNamespaces([
        { name: 'acme.getUser' },
        { name: 'acme.listUsers' },
        { name: 'acme.updateUser' },
      ]);

      expect(skipped).toEqual([]);
      expect(Object.keys(namespaces)).toEqual(['acme']);
      expect(Object.keys(namespaces['acme'])).toEqual(['getUser', 'listUsers', 'updateUser']);
    });

    it('separates different namespaces', () => {
      const { namespaces } = buildToolNamespaces([
        { name: 'acme.getUser' },
        { name: 'billing.getInvoice' },
        { name: 'audit.recordEvent' },
      ]);

      expect(Object.keys(namespaces).sort()).toEqual(['acme', 'audit', 'billing']);
      expect(namespaces['acme']['getUser']).toBe('acme.getUser');
      expect(namespaces['billing']['getInvoice']).toBe('billing.getInvoice');
      expect(namespaces['audit']['recordEvent']).toBe('audit.recordEvent');
    });

    it('produces plain data, never host functions', () => {
      const { namespaces } = buildToolNamespaces([{ name: 'acme.getUser' }]);

      expect(typeof namespaces['acme']['getUser']).toBe('string');
    });

    it('accepts tools that expose extra fields beyond name', () => {
      const tools = [{ name: 'acme.ping', description: 'health', extra: { foo: 1 } }];

      const { namespaces, skipped } = buildToolNamespaces(tools);

      expect(skipped).toEqual([]);
      expect(namespaces['acme']['ping']).toBe('acme.ping');
    });

    it('returns an empty result when the input list is empty', () => {
      const { namespaces, skipped } = buildToolNamespaces([]);

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([]);
    });
  });

  describe('skip reasons', () => {
    it('skips tools whose name does not contain a dot', () => {
      const { namespaces, skipped } = buildToolNamespaces([
        { name: 'codecall:execute' },
        { name: 'plain' },
        { name: 'with_underscore' },
      ]);

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'codecall:execute', reason: 'no-namespace-prefix' },
        { name: 'plain', reason: 'no-namespace-prefix' },
        { name: 'with_underscore', reason: 'no-namespace-prefix' },
      ]);
    });

    it('skips tools whose name starts with a dot', () => {
      const { skipped } = buildToolNamespaces([{ name: '.leading' }]);

      expect(skipped).toEqual([{ name: '.leading', reason: 'no-namespace-prefix' }]);
    });

    it('skips tools whose name ends with a dot', () => {
      const { skipped } = buildToolNamespaces([{ name: 'trailing.' }]);

      expect(skipped).toEqual([{ name: 'trailing.', reason: 'no-namespace-prefix' }]);
    });

    it('skips tools with a non-identifier namespace prefix', () => {
      const { namespaces, skipped } = buildToolNamespaces([
        { name: 'acme-api.getUser' }, // dash
        { name: '1acme.getUser' }, // leading digit
        { name: 'acme api.getUser' }, // space
      ]);

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'acme-api.getUser', reason: 'invalid-identifier' },
        { name: '1acme.getUser', reason: 'invalid-identifier' },
        { name: 'acme api.getUser', reason: 'invalid-identifier' },
      ]);
    });

    it('skips tools with a non-identifier method suffix', () => {
      const { namespaces, skipped } = buildToolNamespaces([
        { name: 'acme.get-user' }, // dash in method
        { name: 'acme.users.list' }, // additional dot → suffix not a single identifier
        { name: 'acme.7th' }, // leading digit
      ]);

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'acme.get-user', reason: 'invalid-identifier' },
        { name: 'acme.users.list', reason: 'invalid-identifier' },
        { name: 'acme.7th', reason: 'invalid-identifier' },
      ]);
    });

    it('skips tools whose prefix collides with a reserved global', () => {
      const { namespaces, skipped } = buildToolNamespaces([
        { name: 'console.log' },
        { name: 'Math.pow' },
        { name: 'JSON.parse' },
        { name: 'globalThis.bad' },
        { name: 'callTool.invoke' },
      ]);

      expect(namespaces).toEqual({});
      expect(skipped).toEqual([
        { name: 'console.log', reason: 'reserved-namespace' },
        { name: 'Math.pow', reason: 'reserved-namespace' },
        { name: 'JSON.parse', reason: 'reserved-namespace' },
        { name: 'globalThis.bad', reason: 'reserved-namespace' },
        { name: 'callTool.invoke', reason: 'reserved-namespace' },
      ]);
    });

    it('skips prefixes a script could not bind: reserved words, AgentScript globals, refused identifiers, "__"', () => {
      const names = [
        'delete.item',
        'class.list',
        'parallel.run',
        'process.exit',
        'eval.run',
        '__ag.x',
        '__codecallNamespaceCall.x',
      ];

      const { namespaces, skipped } = buildToolNamespaces(names.map((name) => ({ name })));

      expect(namespaces).toEqual({});
      expect(skipped).toEqual(names.map((name) => ({ name, reason: 'reserved-namespace' })));
    });

    it('first registration wins on duplicate {ns}.{method}; later ones reported as skipped', () => {
      const { namespaces, skipped } = buildToolNamespaces([{ name: 'acme.getUser' }, { name: 'acme.getUser' }]);

      expect(Object.keys(namespaces['acme'])).toEqual(['getUser']);
      expect(skipped).toEqual([{ name: 'acme.getUser', reason: 'duplicate-method' }]);
    });
  });

  describe('robustness', () => {
    it('silently ignores entries with non-string or empty name', () => {
      const tools = [
        { name: 'acme.ok' },
        { name: '' },
        { name: undefined as unknown as string },
        { name: null as unknown as string },
        { name: 123 as unknown as string },
        null as unknown as { name: string },
      ];

      const { namespaces, skipped } = buildToolNamespaces(tools);

      expect(namespaces).toEqual({ acme: expect.any(Object) });
      expect(namespaces['acme']['ok']).toBe('acme.ok');
      // Empty / invalid entries are not skipped (with a reason) — they're just dropped.
      expect(skipped).toEqual([]);
    });

    it('uses Object.prototype.hasOwnProperty (not inherited prototype keys) for duplicate detection', () => {
      // `toString` is inherited on every plain object — make sure it is NOT treated as
      // already present when used as a method name.
      const { namespaces, skipped } = buildToolNamespaces([{ name: 'acme.toString' }]);

      expect(skipped).toEqual([]);
      expect(namespaces['acme']['toString']).toBe('acme.toString');
    });
  });
});

/**
 * GHSA-cmrw-xhcg-6gf9 — a tool name whose NAMESPACE is a prototype key must not write onto a
 * JavaScript intrinsic, and must be reported rather than silently dropped.
 */
describe('buildToolNamespaces — prototype keys (GHSA-cmrw-xhcg-6gf9)', () => {
  afterEach(() => {
    // Fail loudly rather than leak pollution into the rest of the suite.
    for (const key of ['pwned', 'polluted']) {
      delete (Object.prototype as Record<string, unknown>)[key];
      delete (Object as unknown as Record<string, unknown>)[key];
    }
  });

  it('does not write onto Object.prototype for a __proto__ namespace', () => {
    buildToolNamespaces([{ name: '__proto__.pwned' }]);

    expect(({} as Record<string, unknown>)['pwned']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'pwned')).toBe(false);
  });

  it('does not write onto the Object constructor for a constructor namespace', () => {
    buildToolNamespaces([{ name: 'constructor.pwned' }]);

    expect((Object as unknown as Record<string, unknown>)['pwned']).toBeUndefined();
  });

  it('does not accept a prototype namespace', () => {
    buildToolNamespaces([{ name: 'prototype.polluted' }]);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('reports the rejection rather than silently dropping it', () => {
    const { skipped } = buildToolNamespaces([{ name: '__proto__.pwned' }]);

    expect(skipped).toEqual([{ name: '__proto__.pwned', reason: 'prototype-key' }]);
  });

  it('refuses a prototype key in the METHOD position too', () => {
    // An object-literal `"__proto__"` key would set the namespace's prototype, and AgentScript
    // refuses `.constructor` / `.prototype` access, so such a method could never be called.
    const { namespaces, skipped } = buildToolNamespaces([
      { name: 'acme.__proto__' },
      { name: 'acme.constructor' },
      { name: 'acme.prototype' },
    ]);

    expect(namespaces).toEqual({});
    expect(skipped.map((entry) => entry.reason)).toEqual(['prototype-key', 'prototype-key', 'prototype-key']);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('keeps building the safe namespaces around a hostile one', () => {
    const { namespaces, skipped } = buildToolNamespaces([{ name: '__proto__.pwned' }, { name: 'safe.ok' }]);

    expect(Object.keys(namespaces)).toEqual(['safe']);
    expect(namespaces['safe']['ok']).toBe('safe.ok');
    expect(skipped).toHaveLength(1);
  });

  it('builds namespace objects with a null prototype', () => {
    const { namespaces } = buildToolNamespaces([{ name: 'safe.ok' }]);

    expect(Object.getPrototypeOf(namespaces)).toBeNull();
    expect(Object.getPrototypeOf(namespaces['safe'])).toBeNull();
  });
});

describe('wrapScriptWithToolNamespaces', () => {
  const { namespaces } = buildToolNamespaces([{ name: 'mail.list' }, { name: 'mail.send' }, { name: 'crm.get' }]);

  it('returns the script unchanged when it uses no namespace', () => {
    const script = "return await callTool('mail.list', {});";

    expect(wrapScriptWithToolNamespaces(script, namespaces)).toBe(script);
    expect(wrapScriptWithToolNamespaces(script, undefined)).toBe(script);
  });

  it('declares only the namespaces the script mentions, with callTool() on a literal tool name', () => {
    const wrapped = wrapScriptWithToolNamespaces('return await mail.list({});', namespaces);

    expect(wrapped).toContain('const mail = {');
    expect(wrapped).toContain('callTool("mail.list", input === undefined ? {} : input)');
    expect(wrapped).toContain('callTool("mail.send", input === undefined ? {} : input)');
    expect(wrapped).not.toContain('const crm');
  });

  it('does not treat a longer identifier or a property as a mention', () => {
    expect(wrapScriptWithToolNamespaces('const mailbox = 1; return mailbox;', namespaces)).toBe(
      'const mailbox = 1; return mailbox;',
    );
  });

  it('keeps the script on the first line so parse-error line numbers do not move', () => {
    const script = 'const a = 1;\nreturn await mail.list({ a });';
    const wrapped = wrapScriptWithToolNamespaces(script, namespaces);

    expect(wrapped.split('\n')).toHaveLength(script.split('\n').length + 1);
    expect(wrapped.split('\n')[1]).toBe('return await mail.list({ a });');
    expect(wrapped.endsWith('\n})();')).toBe(true);
  });

  it('never emits an entry whose tool name does not match its namespace and method', () => {
    const forged = { mail: { list: 'admin.deleteAll' } };

    expect(wrapScriptWithToolNamespaces('return await mail.list({});', forged)).toBe('return await mail.list({});');
  });

  it('never emits a namespace or method it could not safely bind', () => {
    const unsafe = {
      process: { exit: 'process.exit' },
      __proto__x: { a: '__proto__x.a' },
      'bad-name': { a: 'bad-name.a' },
      ok: { __proto__: 'ok.__proto__', 'x"); callTool("admin.x': 'ok.x"); callTool("admin.x' },
    } as Record<string, Record<string, string>>;

    const script = 'return [process, __proto__x, ok];';
    expect(wrapScriptWithToolNamespaces(script, unsafe)).toBe(script);
  });
});
