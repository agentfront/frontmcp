/**
 * Tests for x-frontmcp schema validation functions
 */

import { validateFrontMcpExtension, FRONTMCP_SCHEMA_VERSION, SUPPORTED_VERSIONS } from '../openapi.frontmcp-schema';
import { createMockLogger } from './fixtures';

describe('validateFrontMcpExtension', () => {
  describe('null/undefined handling', () => {
    it('should return success with null data for null input', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(null, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });

    it('should return success with null data for undefined input', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(undefined, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('type validation', () => {
    it('should fail for array input', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(['invalid'], 'testTool', mockLogger);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.warnings).toContain('x-frontmcp must be an object, got array');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should fail for string input', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension('invalid', 'testTool', mockLogger);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.warnings).toContain('x-frontmcp must be an object, got string');
    });

    it('should fail for number input', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(123, 'testTool', mockLogger);

      expect(result.success).toBe(false);
      expect(result.warnings).toContain('x-frontmcp must be an object, got number');
    });
  });

  describe('version handling', () => {
    it('should use default version when not specified', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({}, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe(FRONTMCP_SCHEMA_VERSION);
    });

    it('should accept valid version', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ version: '1.0' }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe('1.0');
    });

    it('should fail for unsupported version', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ version: '2.0' }, 'testTool', mockLogger);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.warnings[0]).toContain('Unsupported x-frontmcp version');
      expect(result.warnings[0]).toContain(SUPPORTED_VERSIONS.join(', '));
    });

    it('should use default version for non-string version', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ version: 123 }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe(FRONTMCP_SCHEMA_VERSION);
    });
  });

  describe('unknown fields', () => {
    it('should warn about unknown top-level fields', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ unknownField: 'value', anotherUnknown: 123 }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain("Unknown field 'unknownField' in x-frontmcp (will be ignored)");
      expect(result.warnings).toContain("Unknown field 'anotherUnknown' in x-frontmcp (will be ignored)");
    });
  });

  describe('annotations validation', () => {
    it('should parse valid annotations', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          annotations: {
            title: 'Test Tool',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.annotations?.title).toBe('Test Tool');
      expect(result.data?.annotations?.readOnlyHint).toBe(true);
      expect(result.data?.annotations?.destructiveHint).toBe(false);
    });

    it('should warn and extract valid fields for partially invalid annotations', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          annotations: {
            title: 123, // Invalid - should be string
            readOnlyHint: true, // Valid
            unknownHint: true, // Unknown field
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.annotations?.readOnlyHint).toBe(true);
      expect(result.data?.annotations?.title).toBeUndefined(); // Invalid field not included
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle non-object annotations', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ annotations: 'invalid' }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.annotations).toBeUndefined();
    });

    it('should warn about unknown annotation fields when validation fails', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          annotations: {
            title: 123, // Invalid - causes validation to fail, triggering extractValidAnnotations
            readOnlyHint: true,
            customField: true, // Unknown field - will be reported in extractValidAnnotations
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.annotations?.readOnlyHint).toBe(true);
      expect(result.warnings.some((w) => w.includes('annotations.customField'))).toBe(true);
    });
  });

  describe('cache validation', () => {
    it('should parse valid cache config', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          cache: {
            ttl: 300,
            slideWindow: true,
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.cache?.ttl).toBe(300);
      expect(result.data?.cache?.slideWindow).toBe(true);
    });

    it('should reject invalid ttl (non-integer)', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          cache: {
            ttl: 3.5, // Not an integer
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('cache.ttl'))).toBe(true);
      expect(result.data?.cache?.ttl).toBeUndefined();
    });

    it('should reject invalid ttl (negative)', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          cache: {
            ttl: -100, // Negative
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('cache.ttl'))).toBe(true);
    });

    it('should reject invalid slideWindow (non-boolean)', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          cache: {
            ttl: 100,
            slideWindow: 'yes', // Should be boolean
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('cache.slideWindow'))).toBe(true);
      expect(result.data?.cache?.ttl).toBe(100);
      expect(result.data?.cache?.slideWindow).toBeUndefined();
    });

    it('should warn about unknown cache fields when validation fails', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          cache: {
            ttl: 'invalid', // Invalid - causes validation to fail, triggering extractValidCache
            customOption: true, // Unknown field
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('cache.customOption'))).toBe(true);
    });

    it('should handle non-object cache', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ cache: 'invalid' }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.cache).toBeUndefined();
    });
  });

  describe('codecall validation', () => {
    it('should parse valid codecall config', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          codecall: {
            enabledInCodeCall: true,
            visibleInListTools: false,
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.codecall?.enabledInCodeCall).toBe(true);
      expect(result.data?.codecall?.visibleInListTools).toBe(false);
    });

    it('should reject invalid enabledInCodeCall', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          codecall: {
            enabledInCodeCall: 'yes', // Should be boolean
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('codecall.enabledInCodeCall'))).toBe(true);
    });

    it('should reject invalid visibleInListTools', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          codecall: {
            visibleInListTools: 1, // Should be boolean
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('codecall.visibleInListTools'))).toBe(true);
    });

    it('should warn about unknown codecall fields when validation fails', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          codecall: {
            enabledInCodeCall: 'invalid', // Invalid - causes validation to fail
            unknownOption: true, // Unknown field
          },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes('codecall.unknownOption'))).toBe(true);
    });

    it('should handle non-object codecall', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ codecall: [] }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.codecall).toBeUndefined();
    });
  });

  describe('tags validation', () => {
    it('should parse valid tags array', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ tags: ['api', 'users', 'public'] }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.tags).toEqual(['api', 'users', 'public']);
    });

    it('should extract valid strings from mixed array', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        { tags: ['valid', 123, 'also-valid', null, true] },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.includes("Invalid 'tags'"))).toBe(true);
      expect(result.data?.tags).toEqual(['valid', 'also-valid']);
    });

    it('should return undefined for non-array tags', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ tags: 'not-an-array' }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.tags).toBeUndefined();
    });

    it('should handle empty tags array', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ tags: [] }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      // Empty array after filtering means undefined
    });
  });

  describe('hideFromDiscovery validation', () => {
    it('should accept boolean true', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ hideFromDiscovery: true }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.hideFromDiscovery).toBe(true);
    });

    it('should accept boolean false', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ hideFromDiscovery: false }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.hideFromDiscovery).toBe(false);
    });

    it('should reject non-boolean value', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ hideFromDiscovery: 'yes' }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.hideFromDiscovery).toBeUndefined();
      expect(result.warnings.some((w) => w.includes('hideFromDiscovery'))).toBe(true);
    });
  });

  describe('examples validation', () => {
    it('should parse valid examples array', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          examples: [
            { description: 'Example 1', input: { id: '1' } },
            { description: 'Example 2', input: { id: '2' }, output: { name: 'Test' } },
          ],
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.examples).toHaveLength(2);
      expect(result.data?.examples?.[0].description).toBe('Example 1');
      expect(result.data?.examples?.[1].output).toEqual({ name: 'Test' });
    });

    it('should filter invalid examples and warn', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          examples: [
            { description: 'Valid', input: { id: '1' } },
            { description: 'Missing input' }, // Invalid - missing input
            { input: { id: '2' } }, // Invalid - missing description
          ],
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.examples).toHaveLength(1);
      expect(result.data?.examples?.[0].description).toBe('Valid');
      expect(result.warnings.some((w) => w.includes('Invalid example at index 1'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('Invalid example at index 2'))).toBe(true);
    });

    it('should return undefined for non-array examples', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension({ examples: 'not-an-array' }, 'testTool', mockLogger);

      expect(result.success).toBe(true);
      expect(result.data?.examples).toBeUndefined();
    });

    it('should handle all invalid examples', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          examples: [{ invalid: true }, { also: 'invalid' }],
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.examples).toBeUndefined();
      expect(result.warnings.some((w) => w.includes('Invalid example'))).toBe(true);
    });
  });

  describe('complete extension', () => {
    it('should parse complete valid extension', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          version: '1.0',
          annotations: {
            title: 'Full Extension',
            readOnlyHint: true,
          },
          cache: {
            ttl: 300,
            slideWindow: true,
          },
          codecall: {
            enabledInCodeCall: true,
            visibleInListTools: false,
          },
          tags: ['api', 'test'],
          hideFromDiscovery: false,
          examples: [{ description: 'Test', input: {} }],
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe('1.0');
      expect(result.data?.annotations?.title).toBe('Full Extension');
      expect(result.data?.cache?.ttl).toBe(300);
      expect(result.data?.codecall?.enabledInCodeCall).toBe(true);
      expect(result.data?.tags).toEqual(['api', 'test']);
      expect(result.data?.hideFromDiscovery).toBe(false);
      expect(result.data?.examples?.[0].description).toBe('Test');
    });

    it('should log warnings when fields are ignored', () => {
      const mockLogger = createMockLogger();
      const result = validateFrontMcpExtension(
        {
          unknownField: true,
          annotations: { customHint: true },
        },
        'testTool',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});

describe('Schema constants', () => {
  it('should export current schema version', () => {
    expect(FRONTMCP_SCHEMA_VERSION).toBe('1.0');
  });

  it('should export supported versions', () => {
    expect(SUPPORTED_VERSIONS).toContain('1.0');
    expect(SUPPORTED_VERSIONS.length).toBeGreaterThan(0);
  });
});
