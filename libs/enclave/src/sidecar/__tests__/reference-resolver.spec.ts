import {
  ReferenceResolver,
  ReferenceSidecar,
  ResolutionLimitError,
  REFERENCE_CONFIGS,
  isCompositeHandle,
} from '../index';

describe('ReferenceResolver', () => {
  let sidecar: ReferenceSidecar;
  let resolver: ReferenceResolver;

  beforeEach(() => {
    sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
    resolver = new ReferenceResolver(sidecar, REFERENCE_CONFIGS.STANDARD);
  });

  afterEach(() => {
    sidecar.dispose();
  });

  describe('predictExpandedSize', () => {
    it('should calculate size of reference ID', () => {
      const refId = sidecar.store('x'.repeat(1000), 'extraction');

      const size = resolver.predictExpandedSize(refId);

      expect(size).toBe(1000);
    });

    it('should calculate size of plain string', () => {
      const size = resolver.predictExpandedSize('Hello, World!');

      expect(size).toBe(Buffer.byteLength('Hello, World!'));
    });

    it('should calculate size of nested objects', () => {
      const ref1 = sidecar.store('data1', 'extraction');
      const ref2 = sidecar.store('data2', 'extraction');

      const value = {
        a: ref1,
        b: {
          c: ref2,
          d: 'plain string',
        },
      };

      const size = resolver.predictExpandedSize(value);

      expect(size).toBe(Buffer.byteLength('data1') + Buffer.byteLength('data2') + Buffer.byteLength('plain string'));
    });

    it('should calculate size of arrays', () => {
      const ref1 = sidecar.store('item1', 'extraction');
      const ref2 = sidecar.store('item2', 'extraction');

      const size = resolver.predictExpandedSize([ref1, ref2, 'plain']);

      expect(size).toBe(Buffer.byteLength('item1') + Buffer.byteLength('item2') + Buffer.byteLength('plain'));
    });

    it('should throw on excessive depth', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT,
        maxResolutionDepth: 2,
      };
      const strictResolver = new ReferenceResolver(sidecar, config);

      const deepObject = {
        a: { b: { c: { d: 'deep' } } },
      };

      expect(() => strictResolver.predictExpandedSize(deepObject)).toThrow(ResolutionLimitError);
    });
  });

  describe('wouldExceedLimit', () => {
    it('should return true when expanded size exceeds limit', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT,
        maxResolvedSize: 100,
      };
      const strictResolver = new ReferenceResolver(sidecar, config);
      const refId = sidecar.store('x'.repeat(200), 'extraction');

      expect(strictResolver.wouldExceedLimit(refId)).toBe(true);
    });

    it('should return false when within limits', () => {
      const config = {
        ...REFERENCE_CONFIGS.STANDARD,
        maxResolvedSize: 1000,
      };
      const resolver = new ReferenceResolver(sidecar, config);
      const refId = sidecar.store('x'.repeat(100), 'extraction');

      expect(resolver.wouldExceedLimit(refId)).toBe(false);
    });
  });

  describe('resolve', () => {
    it('should resolve single reference ID', () => {
      const refId = sidecar.store('resolved data', 'extraction');

      const result = resolver.resolve(refId);

      expect(result).toBe('resolved data');
    });

    it('should pass through plain strings', () => {
      const result = resolver.resolve('plain string');

      expect(result).toBe('plain string');
    });

    it('should pass through primitives', () => {
      expect(resolver.resolve(42)).toBe(42);
      expect(resolver.resolve(true)).toBe(true);
      expect(resolver.resolve(null)).toBe(null);
      expect(resolver.resolve(undefined)).toBe(undefined);
    });

    it('should resolve references in objects', () => {
      const ref1 = sidecar.store('value1', 'extraction');
      const ref2 = sidecar.store('value2', 'extraction');

      const result = resolver.resolve({
        key1: ref1,
        key2: ref2,
        key3: 'plain',
      }) as Record<string, unknown>;

      expect(result['key1']).toBe('value1');
      expect(result['key2']).toBe('value2');
      expect(result['key3']).toBe('plain');
    });

    it('should resolve references in arrays', () => {
      const ref1 = sidecar.store('item1', 'extraction');
      const ref2 = sidecar.store('item2', 'extraction');

      const result = resolver.resolve([ref1, 'plain', ref2]) as unknown[];

      expect(result).toEqual(['item1', 'plain', 'item2']);
    });

    it('should resolve deeply nested references', () => {
      const ref = sidecar.store('deep value', 'extraction');

      const result = resolver.resolve({
        a: {
          b: {
            c: [{ d: ref }],
          },
        },
      }) as any;

      expect(result.a.b.c[0].d).toBe('deep value');
    });

    it('should throw for unknown reference IDs', () => {
      expect(() => resolver.resolve('__REF_00000000-0000-0000-0000-000000000000__')).toThrow(/Unknown reference/);
    });

    it('should throw on excessive depth', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT,
        maxResolutionDepth: 2,
      };
      const strictResolver = new ReferenceResolver(sidecar, config);

      const deepObject = {
        a: { b: { c: { d: 'deep' } } },
      };

      expect(() => strictResolver.resolve(deepObject)).toThrow(ResolutionLimitError);
    });
  });

  describe('containsReferences', () => {
    it('should detect reference IDs', () => {
      const refId = sidecar.store('data', 'extraction');

      expect(resolver.containsReferences(refId)).toBe(true);
    });

    it('should detect references in nested structures', () => {
      const refId = sidecar.store('data', 'extraction');

      expect(resolver.containsReferences({ a: { b: refId } })).toBe(true);
      expect(resolver.containsReferences([[[refId]]])).toBe(true);
    });

    it('should return false for non-references', () => {
      expect(resolver.containsReferences('plain string')).toBe(false);
      expect(resolver.containsReferences({ a: 'b', c: 123 })).toBe(false);
      expect(resolver.containsReferences([1, 2, 3])).toBe(false);
    });
  });

  describe('createComposite', () => {
    it('should concatenate plain strings without creating composite', () => {
      const result = resolver.createComposite(['hello', ' ', 'world']);

      expect(result).toBe('hello world');
    });

    it('should create composite handle when references present and allowed', () => {
      const ref1 = sidecar.store('part1', 'extraction');
      const ref2 = sidecar.store('part2', 'extraction');

      const result = resolver.createComposite([ref1, '-', ref2]);

      expect(isCompositeHandle(result)).toBe(true);
      if (isCompositeHandle(result)) {
        expect(result.__parts).toHaveLength(3);
        expect(result.__parts).toContain(ref1);
        expect(result.__parts).toContain(ref2);
        expect(result.__estimatedSize).toBeGreaterThan(0);
      }
    });

    it('should throw when composites not allowed', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT, // allowComposites: false
      };
      const strictSidecar = new ReferenceSidecar(config);
      const strictResolver = new ReferenceResolver(strictSidecar, config);

      const ref = strictSidecar.store('data', 'extraction');

      expect(() => strictResolver.createComposite([ref, '-suffix'])).toThrow(/Cannot concatenate reference IDs/);

      strictSidecar.dispose();
    });

    it('should throw when composite would exceed size limit', () => {
      const config = {
        ...REFERENCE_CONFIGS.STANDARD,
        maxResolvedSize: 100,
      };
      const resolver = new ReferenceResolver(sidecar, config);

      const ref = sidecar.store('x'.repeat(200), 'extraction');

      expect(() => resolver.createComposite([ref, ref])).toThrow(ResolutionLimitError);
    });
  });

  describe('composite handle resolution', () => {
    it('should resolve composite handles', () => {
      const ref1 = sidecar.store('Hello', 'extraction');
      const ref2 = sidecar.store('World', 'extraction');

      const composite = resolver.createComposite([ref1, ' ', ref2]);

      // Now resolve the composite
      const resolved = resolver.resolve(composite);

      expect(resolved).toBe('Hello World');
    });

    it('should resolve nested composites', () => {
      const ref = sidecar.store('data', 'extraction');
      const composite = resolver.createComposite(['prefix-', ref, '-suffix']);

      const result = resolver.resolve({ key: composite }) as any;

      expect(result.key).toBe('prefix-data-suffix');
    });
  });
});

describe('isCompositeHandle', () => {
  it('should return true for valid composite handles', () => {
    const handle = {
      __type: 'composite',
      __operation: 'concat',
      __parts: ['a', 'b'],
      __estimatedSize: 2,
    };

    expect(isCompositeHandle(handle)).toBe(true);
  });

  it('should return false for non-composite values', () => {
    expect(isCompositeHandle('string')).toBe(false);
    expect(isCompositeHandle(123)).toBe(false);
    expect(isCompositeHandle(null)).toBe(false);
    expect(isCompositeHandle({})).toBe(false);
    expect(isCompositeHandle({ __type: 'other' })).toBe(false);
  });
});
