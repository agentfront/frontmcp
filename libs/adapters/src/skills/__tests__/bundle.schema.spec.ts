import { crossValidate, resolvedBundleSchema } from '../bundle/bundle.schema';

const validBundle = {
  schemaVersion: 1,
  bundleId: 'acme:prod',
  version: '2026.05.01-1',
  generatedAt: '2026-05-01T12:00:00.000Z',
  sourceDigest: 'a'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://api.example.com' }],
  authBindings: { default: { kind: 'bearer', vaultRef: 'stripe-key' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Issue and manage invoices.',
      instructions: '# Invoices',
      operationIds: ['createInvoice'],
    },
  ],
  operations: {
    createInvoice: {
      operationId: 'createInvoice',
      serviceId: 'billing',
      httpMethod: 'POST',
      pathTemplate: '/v1/invoices',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      mapper: [{ inputKey: 'amount', type: 'body', key: 'amount' }],
      authBindingRef: 'default',
    },
  },
};

describe('bundle.schema', () => {
  describe('resolvedBundleSchema', () => {
    it('accepts a minimal valid bundle', () => {
      expect(resolvedBundleSchema.safeParse(validBundle).success).toBe(true);
    });

    it('rejects schemaVersion !== 1', () => {
      const result = resolvedBundleSchema.safeParse({ ...validBundle, schemaVersion: 2 });
      expect(result.success).toBe(false);
    });

    it('rejects unknown top-level fields (strict mode)', () => {
      const result = resolvedBundleSchema.safeParse({ ...validBundle, mysteryField: 1 });
      expect(result.success).toBe(false);
    });

    it('rejects path templates with `..` traversal', () => {
      const bad = JSON.parse(JSON.stringify(validBundle));
      bad.operations.createInvoice.pathTemplate = '/v1/../../etc/passwd';
      const result = resolvedBundleSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects path templates with shell metachars', () => {
      const bad = JSON.parse(JSON.stringify(validBundle));
      bad.operations.createInvoice.pathTemplate = '/v1/invoices`whoami`';
      const result = resolvedBundleSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects apiKey name violating RFC 7230 token grammar', () => {
      const bad = JSON.parse(JSON.stringify(validBundle));
      bad.authBindings['weird'] = { kind: 'apiKey', in: 'header', name: 'X Weird Header', vaultRef: 'r' };
      const result = resolvedBundleSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects bundles whose sourceDigest is not hex', () => {
      const result = resolvedBundleSchema.safeParse({ ...validBundle, sourceDigest: 'not-hex!!' });
      expect(result.success).toBe(false);
    });

    it('rejects bad generatedAt', () => {
      const result = resolvedBundleSchema.safeParse({ ...validBundle, generatedAt: 'yesterday' });
      expect(result.success).toBe(false);
    });
  });

  describe('crossValidate', () => {
    it('returns ok for a consistent bundle', () => {
      const parsed = resolvedBundleSchema.parse(validBundle);
      expect(crossValidate(parsed)).toEqual({ ok: true });
    });

    it('reports unknown serviceId references', () => {
      const bundle = JSON.parse(JSON.stringify(validBundle));
      bundle.operations.createInvoice.serviceId = 'unknown';
      const parsed = resolvedBundleSchema.parse(bundle);
      const result = crossValidate(parsed);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('unknown service'))).toBe(true);
      }
    });

    it('reports unknown authBindingRef', () => {
      const bundle = JSON.parse(JSON.stringify(validBundle));
      bundle.operations.createInvoice.authBindingRef = 'ghost';
      const parsed = resolvedBundleSchema.parse(bundle);
      const result = crossValidate(parsed);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('unknown authBinding'))).toBe(true);
      }
    });

    it('reports skills referencing unknown operations', () => {
      const bundle = JSON.parse(JSON.stringify(validBundle));
      bundle.skills[0].operationIds = ['createInvoice', 'voidInvoice'];
      const parsed = resolvedBundleSchema.parse(bundle);
      const result = crossValidate(parsed);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('voidInvoice'))).toBe(true);
      }
    });

    it('reports duplicate skill ids', () => {
      const bundle = JSON.parse(JSON.stringify(validBundle));
      bundle.skills.push({ ...bundle.skills[0] });
      const parsed = resolvedBundleSchema.parse(bundle);
      const result = crossValidate(parsed);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('duplicate skill id'))).toBe(true);
      }
    });

    it('reports operationId/key mismatch', () => {
      const bundle = JSON.parse(JSON.stringify(validBundle));
      bundle.operations.createInvoice.operationId = 'createDifferent';
      const parsed = resolvedBundleSchema.parse(bundle);
      const result = crossValidate(parsed);
      expect(result.ok).toBe(false);
    });
  });
});
