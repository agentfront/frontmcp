/**
 * TypeScript Type Fetcher Schemas Tests
 *
 * Tests for Zod validation schemas.
 */

import {
  typeFetchErrorCodeSchema,
  typeFetchResultSchema,
  typeFetchErrorSchema,
  typeFetchBatchRequestSchema,
  typeFetchBatchResultSchema,
  typeCacheEntrySchema,
  typeCacheStatsSchema,
  dtsImportTypeSchema,
  dtsImportSchema,
  dtsParseResultSchema,
  typeFetcherOptionsSchema,
  packageResolutionSchema,
  validateBatchRequest,
  safeParseBatchRequest,
  validateTypeFetcherOptions,
  safeParseTypeFetcherOptions,
} from '../schemas';

// ============================================
// Error Code Schema Tests
// ============================================

describe('typeFetchErrorCodeSchema', () => {
  it('should accept valid error codes', () => {
    expect(typeFetchErrorCodeSchema.parse('NETWORK_ERROR')).toBe('NETWORK_ERROR');
    expect(typeFetchErrorCodeSchema.parse('TIMEOUT')).toBe('TIMEOUT');
    expect(typeFetchErrorCodeSchema.parse('NO_TYPES_HEADER')).toBe('NO_TYPES_HEADER');
    expect(typeFetchErrorCodeSchema.parse('INVALID_SPECIFIER')).toBe('INVALID_SPECIFIER');
    expect(typeFetchErrorCodeSchema.parse('PACKAGE_NOT_FOUND')).toBe('PACKAGE_NOT_FOUND');
    expect(typeFetchErrorCodeSchema.parse('PARSE_ERROR')).toBe('PARSE_ERROR');
  });

  it('should reject invalid error codes', () => {
    expect(() => typeFetchErrorCodeSchema.parse('UNKNOWN_ERROR')).toThrow();
    expect(() => typeFetchErrorCodeSchema.parse('')).toThrow();
    expect(() => typeFetchErrorCodeSchema.parse(123)).toThrow();
  });
});

// ============================================
// Type Fetch Result Schema Tests
// ============================================

describe('typeFetchResultSchema', () => {
  const validResult = {
    specifier: 'react',
    resolvedPackage: 'react',
    version: '18.2.0',
    content: 'declare const React: any;',
    fetchedUrls: ['https://esm.sh/react.d.ts'],
    fetchedAt: '2024-01-01T00:00:00.000Z',
  };

  it('should accept valid result', () => {
    const result = typeFetchResultSchema.parse(validResult);
    expect(result.specifier).toBe('react');
  });

  it('should reject missing fields', () => {
    const { specifier, ...withoutSpecifier } = validResult;
    expect(() => typeFetchResultSchema.parse(withoutSpecifier)).toThrow();
  });

  it('should reject invalid URL format', () => {
    expect(() =>
      typeFetchResultSchema.parse({
        ...validResult,
        fetchedUrls: ['not-a-url'],
      }),
    ).toThrow();
  });

  it('should reject invalid datetime format', () => {
    expect(() =>
      typeFetchResultSchema.parse({
        ...validResult,
        fetchedAt: 'invalid-date',
      }),
    ).toThrow();
  });

  it('should reject extra fields with strict mode', () => {
    expect(() =>
      typeFetchResultSchema.parse({
        ...validResult,
        extraField: 'should fail',
      }),
    ).toThrow();
  });
});

// ============================================
// Type Fetch Error Schema Tests
// ============================================

describe('typeFetchErrorSchema', () => {
  const validError = {
    specifier: 'nonexistent-package',
    code: 'PACKAGE_NOT_FOUND',
    message: 'Could not find package',
  };

  it('should accept valid error', () => {
    const result = typeFetchErrorSchema.parse(validError);
    expect(result.code).toBe('PACKAGE_NOT_FOUND');
  });

  it('should accept optional url field', () => {
    const withUrl = {
      ...validError,
      url: 'https://esm.sh/nonexistent',
    };
    const result = typeFetchErrorSchema.parse(withUrl);
    expect(result.url).toBe('https://esm.sh/nonexistent');
  });

  it('should reject invalid error code', () => {
    expect(() =>
      typeFetchErrorSchema.parse({
        ...validError,
        code: 'INVALID_CODE',
      }),
    ).toThrow();
  });

  it('should reject empty message', () => {
    expect(() =>
      typeFetchErrorSchema.parse({
        ...validError,
        message: '',
      }),
    ).toThrow();
  });
});

// ============================================
// Batch Request Schema Tests
// ============================================

describe('typeFetchBatchRequestSchema', () => {
  it('should accept valid request with required fields only', () => {
    const result = typeFetchBatchRequestSchema.parse({
      imports: ['import React from "react"'],
    });
    expect(result.imports).toHaveLength(1);
  });

  it('should accept all optional fields', () => {
    const result = typeFetchBatchRequestSchema.parse({
      imports: ['import { FC } from "react"'],
      maxDepth: 3,
      timeout: 5000,
      maxConcurrency: 10,
      skipCache: true,
      versionOverrides: { react: '17.0.2' },
    });

    expect(result.maxDepth).toBe(3);
    expect(result.skipCache).toBe(true);
  });

  it('should reject empty imports array', () => {
    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: [],
      }),
    ).toThrow();
  });

  it('should reject maxDepth out of range', () => {
    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: ['import React from "react"'],
        maxDepth: 15,
      }),
    ).toThrow();

    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: ['import React from "react"'],
        maxDepth: -1,
      }),
    ).toThrow();
  });

  it('should reject timeout out of range', () => {
    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: ['import React from "react"'],
        timeout: 100, // Too small
      }),
    ).toThrow();

    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: ['import React from "react"'],
        timeout: 100000, // Too large
      }),
    ).toThrow();
  });

  it('should reject maxConcurrency out of range', () => {
    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: ['import React from "react"'],
        maxConcurrency: 0,
      }),
    ).toThrow();

    expect(() =>
      typeFetchBatchRequestSchema.parse({
        imports: ['import React from "react"'],
        maxConcurrency: 50,
      }),
    ).toThrow();
  });
});

// ============================================
// Batch Result Schema Tests
// ============================================

describe('typeFetchBatchResultSchema', () => {
  it('should accept valid batch result', () => {
    const result = typeFetchBatchResultSchema.parse({
      results: [
        {
          specifier: 'react',
          resolvedPackage: 'react',
          version: '18.2.0',
          content: 'declare const React: any;',
          fetchedUrls: ['https://esm.sh/react.d.ts'],
          fetchedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      errors: [],
      totalTimeMs: 100,
      cacheHits: 0,
      networkRequests: 1,
    });

    expect(result.results).toHaveLength(1);
  });

  it('should accept empty results with errors', () => {
    const result = typeFetchBatchResultSchema.parse({
      results: [],
      errors: [
        {
          specifier: 'bad-package',
          code: 'PACKAGE_NOT_FOUND',
          message: 'Not found',
        },
      ],
      totalTimeMs: 50,
      cacheHits: 0,
      networkRequests: 1,
    });

    expect(result.errors).toHaveLength(1);
  });
});

// ============================================
// Cache Entry Schema Tests
// ============================================

describe('typeCacheEntrySchema', () => {
  it('should accept valid cache entry', () => {
    const result = typeCacheEntrySchema.parse({
      result: {
        specifier: 'lodash',
        resolvedPackage: 'lodash',
        version: '4.17.21',
        content: 'declare function debounce(): void;',
        fetchedUrls: ['https://esm.sh/lodash.d.ts'],
        fetchedAt: '2024-01-01T00:00:00.000Z',
      },
      cachedAt: Date.now(),
      size: 1000,
      accessCount: 5,
    });

    expect(result.accessCount).toBe(5);
  });

  it('should reject negative values', () => {
    expect(() =>
      typeCacheEntrySchema.parse({
        result: {
          specifier: 'lodash',
          resolvedPackage: 'lodash',
          version: '4.17.21',
          content: '',
          fetchedUrls: [],
          fetchedAt: '2024-01-01T00:00:00.000Z',
        },
        cachedAt: Date.now(),
        size: -100,
        accessCount: 0,
      }),
    ).toThrow();
  });
});

// ============================================
// Cache Stats Schema Tests
// ============================================

describe('typeCacheStatsSchema', () => {
  it('should accept valid stats', () => {
    const result = typeCacheStatsSchema.parse({
      entries: 10,
      totalSize: 50000,
      hits: 100,
      misses: 20,
      hitRate: 0.833,
    });

    expect(result.hitRate).toBe(0.833);
  });

  it('should reject hitRate outside 0-1 range', () => {
    expect(() =>
      typeCacheStatsSchema.parse({
        entries: 0,
        totalSize: 0,
        hits: 0,
        misses: 0,
        hitRate: 1.5,
      }),
    ).toThrow();

    expect(() =>
      typeCacheStatsSchema.parse({
        entries: 0,
        totalSize: 0,
        hits: 0,
        misses: 0,
        hitRate: -0.1,
      }),
    ).toThrow();
  });
});

// ============================================
// DTS Import Schema Tests
// ============================================

describe('dtsImportTypeSchema', () => {
  it('should accept valid import types', () => {
    expect(dtsImportTypeSchema.parse('import')).toBe('import');
    expect(dtsImportTypeSchema.parse('export')).toBe('export');
    expect(dtsImportTypeSchema.parse('reference')).toBe('reference');
    expect(dtsImportTypeSchema.parse('declare-module')).toBe('declare-module');
  });

  it('should reject invalid types', () => {
    expect(() => dtsImportTypeSchema.parse('require')).toThrow();
  });
});

describe('dtsImportSchema', () => {
  it('should accept valid dts import', () => {
    const result = dtsImportSchema.parse({
      type: 'import',
      specifier: 'react',
      statement: "import { FC } from 'react';",
      line: 1,
    });

    expect(result.specifier).toBe('react');
  });

  it('should reject line <= 0', () => {
    expect(() =>
      dtsImportSchema.parse({
        type: 'import',
        specifier: 'react',
        statement: "import React from 'react';",
        line: 0,
      }),
    ).toThrow();
  });
});

describe('dtsParseResultSchema', () => {
  it('should accept valid parse result', () => {
    const result = dtsParseResultSchema.parse({
      imports: [
        {
          type: 'import',
          specifier: 'react',
          statement: "import { FC } from 'react';",
          line: 1,
        },
      ],
      externalPackages: ['react'],
      relativeImports: ['./types'],
    });

    expect(result.externalPackages).toContain('react');
  });
});

// ============================================
// Type Fetcher Options Schema Tests
// ============================================

describe('typeFetcherOptionsSchema', () => {
  it('should accept empty object', () => {
    const result = typeFetcherOptionsSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept all valid options', () => {
    const result = typeFetcherOptionsSchema.parse({
      maxDepth: 3,
      timeout: 5000,
      maxConcurrency: 10,
      cdnBaseUrl: 'https://custom-cdn.com',
    });

    expect(result.maxDepth).toBe(3);
    expect(result.cdnBaseUrl).toBe('https://custom-cdn.com');
  });

  it('should reject invalid cdnBaseUrl', () => {
    expect(() =>
      typeFetcherOptionsSchema.parse({
        cdnBaseUrl: 'not-a-url',
      }),
    ).toThrow();
  });
});

// ============================================
// Package Resolution Schema Tests
// ============================================

describe('packageResolutionSchema', () => {
  it('should accept valid resolution', () => {
    const result = packageResolutionSchema.parse({
      packageName: '@frontmcp/ui',
      subpath: 'react',
      version: '1.0.0',
      typesUrl: 'https://esm.sh/@frontmcp/ui@1.0.0/index.d.ts',
    });

    expect(result.packageName).toBe('@frontmcp/ui');
    expect(result.subpath).toBe('react');
  });

  it('should accept without optional subpath', () => {
    const result = packageResolutionSchema.parse({
      packageName: 'react',
      version: '18.2.0',
      typesUrl: 'https://esm.sh/react@18.2.0/index.d.ts',
    });

    expect(result.subpath).toBeUndefined();
  });

  it('should reject invalid types URL', () => {
    expect(() =>
      packageResolutionSchema.parse({
        packageName: 'react',
        version: '18.2.0',
        typesUrl: 'invalid-url',
      }),
    ).toThrow();
  });
});

// ============================================
// Validation Helper Tests
// ============================================

describe('validateBatchRequest', () => {
  it('should return valid data for valid input', () => {
    const result = validateBatchRequest({
      imports: ['import React from "react"'],
    });

    expect(result.imports).toHaveLength(1);
  });

  it('should throw for invalid input', () => {
    expect(() => validateBatchRequest({ imports: [] })).toThrow();
  });
});

describe('safeParseBatchRequest', () => {
  it('should return success for valid input', () => {
    const result = safeParseBatchRequest({
      imports: ['import React from "react"'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imports).toHaveLength(1);
    }
  });

  it('should return error for invalid input', () => {
    const result = safeParseBatchRequest({ imports: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('validateTypeFetcherOptions', () => {
  it('should return valid options', () => {
    const result = validateTypeFetcherOptions({
      maxDepth: 3,
    });

    expect(result.maxDepth).toBe(3);
  });

  it('should throw for invalid options', () => {
    expect(() =>
      validateTypeFetcherOptions({
        maxDepth: 100, // Too high
      }),
    ).toThrow();
  });
});

describe('safeParseTypeFetcherOptions', () => {
  it('should return success for valid options', () => {
    const result = safeParseTypeFetcherOptions({
      timeout: 5000,
    });

    expect(result.success).toBe(true);
  });

  it('should return error for invalid options', () => {
    const result = safeParseTypeFetcherOptions({
      timeout: 100, // Too low
    });

    expect(result.success).toBe(false);
  });
});
