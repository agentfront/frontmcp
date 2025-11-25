import {
  ReferenceSidecar,
  SidecarLimitError,
  ReferenceNotFoundError,
  REFERENCE_CONFIGS,
  REF_ID_PATTERN,
  isReferenceId,
} from '../index';

describe('ReferenceSidecar', () => {
  describe('store and retrieve', () => {
    it('should store a string and return a reference ID', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const data = 'Hello, World!';

      const refId = sidecar.store(data, 'extraction');

      expect(refId).toMatch(REF_ID_PATTERN);
      expect(sidecar.has(refId)).toBe(true);
    });

    it('should store a Buffer and return a reference ID', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const data = Buffer.from('Binary data');

      const refId = sidecar.store(data, 'tool-result');

      expect(refId).toMatch(REF_ID_PATTERN);
      expect(sidecar.has(refId)).toBe(true);
    });

    it('should retrieve stored string data', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const data = 'Test data for retrieval';

      const refId = sidecar.store(data, 'extraction');
      const retrieved = sidecar.retrieveString(refId);

      expect(retrieved).toBe(data);
    });

    it('should retrieve stored Buffer data', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const data = Buffer.from([1, 2, 3, 4, 5]);

      const refId = sidecar.store(data, 'extraction');
      const retrieved = sidecar.retrieve(refId);

      expect(retrieved).toEqual(data);
    });

    it('should return undefined for unknown reference IDs', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);

      const retrieved = sidecar.retrieve('__REF_00000000-0000-0000-0000-000000000000__');

      expect(retrieved).toBeUndefined();
    });

    it('should generate unique reference IDs', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const refs = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const refId = sidecar.store(`data-${i}`, 'extraction');
        refs.add(refId);
      }

      expect(refs.size).toBe(100);
    });
  });

  describe('metadata tracking', () => {
    it('should track reference metadata', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const data = 'Test data';

      const refId = sidecar.store(data, 'extraction', {
        mimeType: 'text/plain',
        origin: 'test-tool',
      });
      const metadata = sidecar.getMetadata(refId);

      expect(metadata).toBeDefined();
      expect(metadata?.size).toBe(Buffer.byteLength(data));
      expect(metadata?.source).toBe('extraction');
      expect(metadata?.mimeType).toBe('text/plain');
      expect(metadata?.origin).toBe('test-tool');
      expect(metadata?.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should track total size', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);

      sidecar.store('12345', 'extraction'); // 5 bytes
      sidecar.store('67890', 'extraction'); // 5 bytes

      expect(sidecar.getTotalSize()).toBe(10);
    });

    it('should track reference count', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);

      sidecar.store('data1', 'extraction');
      sidecar.store('data2', 'extraction');
      sidecar.store('data3', 'extraction');

      expect(sidecar.getCount()).toBe(3);
    });

    it('should provide audit log', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);

      const ref1 = sidecar.store('data1', 'extraction');
      const ref2 = sidecar.store('data2', 'tool-result');

      const auditLog = sidecar.getAuditLog();

      expect(auditLog).toHaveLength(2);
      expect(auditLog.map((e) => e.refId)).toContain(ref1);
      expect(auditLog.map((e) => e.refId)).toContain(ref2);
    });
  });

  describe('limit enforcement', () => {
    it('should reject data exceeding maxReferenceSize', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT,
        maxReferenceSize: 100, // 100 bytes max per reference
      };
      const sidecar = new ReferenceSidecar(config);
      const data = 'x'.repeat(200); // 200 bytes

      try {
        sidecar.store(data, 'extraction');
        fail('Expected SidecarLimitError');
      } catch (e) {
        expect(e).toBeInstanceOf(SidecarLimitError);
        expect((e as SidecarLimitError).code).toBe('MAX_REFERENCE_SIZE');
      }
    });

    it('should reject data exceeding maxTotalSize', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT,
        maxTotalSize: 100, // 100 bytes total
      };
      const sidecar = new ReferenceSidecar(config);

      sidecar.store('x'.repeat(50), 'extraction'); // 50 bytes
      sidecar.store('x'.repeat(40), 'extraction'); // 40 bytes

      try {
        sidecar.store('x'.repeat(20), 'extraction');
        fail('Expected SidecarLimitError');
      } catch (e) {
        expect(e).toBeInstanceOf(SidecarLimitError);
        expect((e as SidecarLimitError).code).toBe('MAX_TOTAL_SIZE');
      }
    });

    it('should reject exceeding maxReferenceCount', () => {
      const config = {
        ...REFERENCE_CONFIGS.STRICT,
        maxReferenceCount: 3,
      };
      const sidecar = new ReferenceSidecar(config);

      sidecar.store('data1', 'extraction');
      sidecar.store('data2', 'extraction');
      sidecar.store('data3', 'extraction');

      try {
        sidecar.store('data4', 'extraction');
        fail('Expected SidecarLimitError');
      } catch (e) {
        expect(e).toBeInstanceOf(SidecarLimitError);
        expect((e as SidecarLimitError).code).toBe('MAX_REFERENCE_COUNT');
      }
    });
  });

  describe('disposal', () => {
    it('should clear all data on dispose', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const refId = sidecar.store('test data', 'extraction');

      sidecar.dispose();

      expect(sidecar.retrieve(refId)).toBeUndefined();
      expect(sidecar.getTotalSize()).toBe(0);
      expect(sidecar.getCount()).toBe(0);
      expect(sidecar.isDisposed()).toBe(true);
    });

    it('should prevent store after dispose', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      sidecar.dispose();

      expect(() => sidecar.store('data', 'extraction')).toThrow(/disposed/);
    });

    it('should be idempotent', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      sidecar.store('data', 'extraction');

      sidecar.dispose();
      sidecar.dispose(); // Should not throw

      expect(sidecar.isDisposed()).toBe(true);
    });
  });

  describe('defensive copying', () => {
    it('should not be affected by mutations to stored Buffer', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const original = Buffer.from('original');

      const refId = sidecar.store(original, 'extraction');
      original[0] = 0x00; // Mutate original

      const retrieved = sidecar.retrieve(refId);
      expect(retrieved?.toString()).toBe('original');
    });

    it('should not allow mutations via retrieved Buffer', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const refId = sidecar.store('original', 'extraction');

      const retrieved1 = sidecar.retrieve(refId)!;
      retrieved1[0] = 0x00; // Mutate retrieved copy

      const retrieved2 = sidecar.retrieve(refId);
      expect(retrieved2?.toString()).toBe('original');
    });
  });

  describe('isReference helper', () => {
    it('should return true for valid reference IDs', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const refId = sidecar.store('data', 'extraction');

      expect(sidecar.isReference(refId)).toBe(true);
    });

    it('should return false for non-reference strings', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);

      expect(sidecar.isReference('not a reference')).toBe(false);
      expect(sidecar.isReference('__REF_invalid__')).toBe(false);
      expect(sidecar.isReference('')).toBe(false);
    });

    it('should return false for non-strings', () => {
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);

      expect(sidecar.isReference(123)).toBe(false);
      expect(sidecar.isReference(null)).toBe(false);
      expect(sidecar.isReference(undefined)).toBe(false);
      expect(sidecar.isReference({})).toBe(false);
    });
  });
});

describe('isReferenceId', () => {
  it('should match valid reference ID format', () => {
    expect(isReferenceId('__REF_12345678-1234-1234-1234-123456789abc__')).toBe(true);
    expect(isReferenceId('__REF_ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF__')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(isReferenceId('__REF_invalid__')).toBe(false);
    expect(isReferenceId('REF_12345678-1234-1234-1234-123456789abc')).toBe(false);
    expect(isReferenceId('__REF_12345678-1234-1234-1234-123456789abc')).toBe(false);
    expect(isReferenceId('some random string')).toBe(false);
  });
});
