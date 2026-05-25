// file: libs/adapters/src/skills/__tests__/op-reference.spec.ts

import {
  buildKnownOps,
  dedupeOpReferences,
  extractOpReferences,
  validateOpReferences,
} from '../harvester/op-reference';

describe('extractOpReferences', () => {
  describe('URI form', () => {
    it('extracts a single bare op:// reference', () => {
      const refs = extractOpReferences('See op://acme-api/getUserById for details.');

      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        spec: 'acme-api',
        operationId: 'getUserById',
        syntax: 'uri',
        raw: 'op://acme-api/getUserById',
      });
      expect(refs[0].location).toEqual({ line: 1, column: 5, offset: 4 });
    });

    it('extracts op:// nested inside a markdown link', () => {
      const md = '[Fetch the user](op://acme-api/getUserById)';
      const refs = extractOpReferences(md);

      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        spec: 'acme-api',
        operationId: 'getUserById',
        syntax: 'uri',
      });
    });

    it('does not match when the prefix is glued to another word', () => {
      const refs = extractOpReferences('aop://acme/getUser top://acme/getUser');
      expect(refs).toEqual([]);
    });

    it('extracts multiple URI references in order', () => {
      const md = ['First fetch op://acme-api/getOrder.', 'Then call op://billing-api/postLedger if applicable.'].join(
        '\n',
      );

      const refs = extractOpReferences(md);

      expect(refs.map((r) => `${r.spec}/${r.operationId}`)).toEqual(['acme-api/getOrder', 'billing-api/postLedger']);
      expect(refs[0].location.line).toBe(1);
      expect(refs[1].location.line).toBe(2);
    });
  });

  describe('wikilink form', () => {
    it('extracts a single [[op:...]] reference', () => {
      const refs = extractOpReferences('See [[op:acme-api/getUserById]] for details.');

      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        spec: 'acme-api',
        operationId: 'getUserById',
        syntax: 'wikilink',
        raw: '[[op:acme-api/getUserById]]',
      });
    });

    it('tolerates a single space after op:', () => {
      const refs = extractOpReferences('Look at [[op: acme-api/getUserById]].');

      expect(refs).toHaveLength(1);
      expect(refs[0].syntax).toBe('wikilink');
      expect(refs[0].operationId).toBe('getUserById');
    });

    it('extracts multiple wikilinks across lines', () => {
      const md = ['- [[op:acme/getUser]]', '- [[op:acme/updateUser]]', '- [[op:billing/getInvoice]]'].join('\n');

      const refs = extractOpReferences(md);
      expect(refs.map((r) => r.operationId)).toEqual(['getUser', 'updateUser', 'getInvoice']);
    });
  });

  describe('mixed syntaxes and ordering', () => {
    it('returns both forms in source order', () => {
      const md = [
        'Start with op://acme/getOrder.',
        'Cross-reference: [[op:billing/postLedger]].',
        'Finish at op://acme/issueRefund.',
      ].join('\n');

      const refs = extractOpReferences(md);

      expect(refs.map((r) => ({ syntax: r.syntax, op: r.operationId }))).toEqual([
        { syntax: 'uri', op: 'getOrder' },
        { syntax: 'wikilink', op: 'postLedger' },
        { syntax: 'uri', op: 'issueRefund' },
      ]);
    });

    it('reports accurate locations across multi-line markdown', () => {
      const md = ['Line one.', '', 'Line three with op://acme/getOrder.'].join('\n');

      const refs = extractOpReferences(md);
      expect(refs).toHaveLength(1);
      expect(refs[0].location.line).toBe(3);
      // Column 17 is the position of `o` in `op://...` on line three.
      expect(refs[0].location.column).toBe(17);
    });
  });

  describe('input robustness', () => {
    it('returns an empty array for empty input', () => {
      expect(extractOpReferences('')).toEqual([]);
    });

    it('returns an empty array for non-string input', () => {
      expect(extractOpReferences(undefined as unknown as string)).toEqual([]);
      expect(extractOpReferences(null as unknown as string)).toEqual([]);
      expect(extractOpReferences(42 as unknown as string)).toEqual([]);
    });

    it('does not match references with invalid identifier operation IDs', () => {
      // Operation IDs must be valid JS identifiers (no dashes, no dots, no leading digits).
      const md = 'op://acme/get-user op://acme/7th op://acme/users.list';
      expect(extractOpReferences(md)).toEqual([]);
    });

    it('does not match references with empty spec or empty operation', () => {
      const md = 'op:///getUser op://acme/ op:// op:';
      expect(extractOpReferences(md)).toEqual([]);
    });

    it('is safe to call repeatedly (regex state does not leak)', () => {
      const md = 'op://acme/getUser and op://acme/listUsers';
      const first = extractOpReferences(md);
      const second = extractOpReferences(md);
      expect(first).toEqual(second);
      expect(first).toHaveLength(2);
    });
  });
});

describe('buildKnownOps', () => {
  it('groups entries by spec id', () => {
    const known = buildKnownOps(['acme/getUser', 'acme/updateUser', 'billing/getInvoice']);

    expect(Array.from(known.keys()).sort()).toEqual(['acme', 'billing']);
    expect(Array.from(known.get('acme')!).sort()).toEqual(['getUser', 'updateUser']);
    expect(Array.from(known.get('billing')!)).toEqual(['getInvoice']);
  });

  it('silently ignores malformed entries', () => {
    const known = buildKnownOps(['no-slash', '/leading-slash', 'trailing/', 'acme/ok']);
    expect(Array.from(known.keys())).toEqual(['acme']);
    expect(Array.from(known.get('acme')!)).toEqual(['ok']);
  });

  it('returns an empty map for empty input', () => {
    expect(buildKnownOps([]).size).toBe(0);
  });
});

describe('validateOpReferences', () => {
  const known = buildKnownOps(['acme/getUser', 'acme/updateUser', 'acme/listUsers', 'billing/getInvoice']);

  it('returns no diagnostics for fully-resolved references', () => {
    const refs = extractOpReferences('op://acme/getUser then [[op:billing/getInvoice]]');
    expect(validateOpReferences(refs, known)).toEqual([]);
  });

  it('flags references to unknown specs', () => {
    const refs = extractOpReferences('op://typo-spec/getUser');
    const diags = validateOpReferences(refs, known);

    expect(diags).toHaveLength(1);
    expect(diags[0].kind).toBe('unknown-spec');
    expect(diags[0].suggestions).toEqual(['acme', 'billing']);
    expect(diags[0].message).toMatch(/Unknown OpenAPI spec "typo-spec"/);
  });

  it('flags unknown operations within a known spec', () => {
    const refs = extractOpReferences('op://acme/getUserr');
    const diags = validateOpReferences(refs, known);

    expect(diags).toHaveLength(1);
    expect(diags[0].kind).toBe('unknown-operation');
    expect(diags[0].suggestions).toContain('getUser');
  });

  it('returns multiple diagnostics in source order', () => {
    const refs = extractOpReferences('op://acme/nope1 then op://nowhere/x then op://acme/nope2');
    const diags = validateOpReferences(refs, known);
    expect(diags.map((d) => d.kind)).toEqual(['unknown-operation', 'unknown-spec', 'unknown-operation']);
  });
});

describe('dedupeOpReferences', () => {
  it('returns unique (spec, operationId) pairs preserving first-appearance order', () => {
    const refs = extractOpReferences(
      [
        'See op://acme/getUser first.',
        '[[op:billing/postLedger]]',
        'Then again op://acme/getUser.',
        'Wikilink form: [[op:acme/getUser]] same pair.',
      ].join('\n'),
    );

    expect(dedupeOpReferences(refs)).toEqual([
      { spec: 'acme', operationId: 'getUser' },
      { spec: 'billing', operationId: 'postLedger' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeOpReferences([])).toEqual([]);
  });
});
