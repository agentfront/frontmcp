import { HiddenOpRegistry, type HiddenOpEntry } from '../registry/hidden-op.registry';

const buildEntry = (skillId: string, opId: string): HiddenOpEntry => ({
  skillId,
  bundleId: 'test:bundle',
  bundleVersion: 'v1',
  service: { id: 'svc', baseUrl: 'https://example.com' },
  authBinding: { kind: 'none' },
  op: {
    operationId: opId,
    serviceId: 'svc',
    httpMethod: 'GET',
    pathTemplate: `/${opId}`,
    inputSchema: {},
    outputSchema: {},
    mapper: [],
    authBindingRef: 'def',
  },
});

describe('HiddenOpRegistry', () => {
  it('starts empty', () => {
    const r = new HiddenOpRegistry();
    expect(r.size).toBe(0);
  });

  it('set + get round-trips by (skillId, actionId)', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('billing', 'createInvoice'));
    const e = r.get('billing', 'createInvoice');
    expect(e?.op.operationId).toBe('createInvoice');
    expect(e?.skillId).toBe('billing');
  });

  it('returns undefined for unknown skill or action', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('billing', 'createInvoice'));
    expect(r.get('billing', 'voidInvoice')).toBeUndefined();
    expect(r.get('customers', 'createInvoice')).toBeUndefined();
  });

  it('replaces existing entry on set with same key', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('billing', 'createInvoice'));
    const replacement = buildEntry('billing', 'createInvoice');
    replacement.bundleVersion = 'v2';
    r.set(replacement);
    expect(r.get('billing', 'createInvoice')?.bundleVersion).toBe('v2');
    expect(r.size).toBe(1);
  });

  it('delete removes a single entry and returns true', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('a', 'op1'));
    expect(r.delete('a', 'op1')).toBe(true);
    expect(r.delete('a', 'op1')).toBe(false);
  });

  it('deleteSkill removes only the matching skill entries', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('a', 'op1'));
    r.set(buildEntry('a', 'op2'));
    r.set(buildEntry('b', 'op1'));
    expect(r.deleteSkill('a')).toBe(2);
    expect(r.size).toBe(1);
    expect(r.get('b', 'op1')).toBeDefined();
  });

  it('values yields all entries', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('a', 'op1'));
    r.set(buildEntry('b', 'op1'));
    expect([...r.values()]).toHaveLength(2);
  });

  it('clear empties the registry', () => {
    const r = new HiddenOpRegistry();
    r.set(buildEntry('a', 'op1'));
    r.clear();
    expect(r.size).toBe(0);
  });

  it('keys with spaces in skill or op ids are handled distinctly', () => {
    // skillId 'a' / opId 'b c' must be distinct from skillId 'a b' / opId 'c'.
    const r = new HiddenOpRegistry();
    const e1 = buildEntry('a', 'b c');
    const e2 = buildEntry('a b', 'c');
    r.set(e1);
    r.set(e2);
    expect(r.size).toBe(2);
    expect(r.get('a', 'b c')?.op.operationId).toBe('b c');
    expect(r.get('a b', 'c')?.op.operationId).toBe('c');
  });
});
