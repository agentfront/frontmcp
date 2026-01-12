/**
 * Unit tests for W3C Trace Context utilities
 */

import { parseTraceContext, generateTraceContext, createChildSpanContext, TraceContext } from '../trace-context';

describe('parseTraceContext', () => {
  describe('W3C traceparent header parsing', () => {
    it('should parse valid traceparent header', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(ctx.parentId).toBe('b7ad6b7169203331');
      expect(ctx.traceFlags).toBe(1);
      expect(ctx.raw).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    });

    it('should lowercase trace and parent IDs', () => {
      const headers = {
        traceparent: '00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(ctx.parentId).toBe('b7ad6b7169203331');
    });

    it('should parse sampled flag (01)', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceFlags).toBe(1);
    });

    it('should parse not-sampled flag (00)', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceFlags).toBe(0);
    });

    it('should parse other trace flags', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-ff',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceFlags).toBe(255);
    });
  });

  describe('invalid traceparent handling', () => {
    it('should generate new context for invalid version', () => {
      const headers = {
        traceparent: '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      // Should generate new context, not use the invalid one
      expect(ctx.traceId).not.toBe('0af7651916cd43dd8448eb211c80319c');
      expect(ctx.traceId).toHaveLength(32);
    });

    it('should generate new context for missing parts', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.parentId).toHaveLength(16);
    });

    it('should generate new context for invalid trace ID (wrong length)', () => {
      const headers = {
        traceparent: '00-0af765-b7ad6b7169203331-01', // trace ID too short
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toHaveLength(32);
    });

    it('should generate new context for all-zero trace ID', () => {
      const headers = {
        traceparent: '00-00000000000000000000000000000000-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).not.toBe('00000000000000000000000000000000');
    });

    it('should generate new context for invalid parent ID (wrong length)', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad-01', // parent ID too short
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.parentId).toHaveLength(16);
    });

    it('should generate new context for all-zero parent ID', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.parentId).not.toBe('0000000000000000');
    });

    it('should generate new context for non-hex characters', () => {
      const headers = {
        traceparent: '00-ghijklmnopqrstuv8448eb211c80319c-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.traceId).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate new context for invalid flags', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-gg',
      };

      const ctx = parseTraceContext(headers);

      // Should fall through to generate
      expect(ctx.traceId).toHaveLength(32);
    });
  });

  describe('x-frontmcp-trace-id fallback', () => {
    it('should use x-frontmcp-trace-id when traceparent missing', () => {
      const headers = {
        'x-frontmcp-trace-id': 'abcd1234abcd1234abcd1234abcd1234',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('abcd1234abcd1234abcd1234abcd1234');
      expect(ctx.parentId).toHaveLength(16);
      expect(ctx.traceFlags).toBe(1); // Default sampled
    });

    it('should prefer traceparent over x-frontmcp-trace-id', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        'x-frontmcp-trace-id': 'ffffffffffffffffffffffffffffffff',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('should lowercase x-frontmcp-trace-id', () => {
      const headers = {
        'x-frontmcp-trace-id': 'ABCD1234ABCD1234ABCD1234ABCD1234',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('abcd1234abcd1234abcd1234abcd1234');
    });

    it('should generate context for invalid x-frontmcp-trace-id', () => {
      const headers = {
        'x-frontmcp-trace-id': 'too-short',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).not.toBe('too-short');
      expect(ctx.traceId).toHaveLength(32);
    });

    it('should generate raw traceparent from x-frontmcp-trace-id', () => {
      const headers = {
        'x-frontmcp-trace-id': 'abcd1234abcd1234abcd1234abcd1234',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.raw).toMatch(/^00-abcd1234abcd1234abcd1234abcd1234-[a-f0-9]{16}-01$/);
    });
  });

  describe('generate new context fallback', () => {
    it('should generate context when no headers present', () => {
      const ctx = parseTraceContext({});

      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.traceId).toMatch(/^[a-f0-9]+$/);
      expect(ctx.parentId).toHaveLength(16);
      expect(ctx.parentId).toMatch(/^[a-f0-9]+$/);
      expect(ctx.traceFlags).toBe(1);
      expect(ctx.raw).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    });

    it('should generate unique trace IDs', () => {
      const ctx1 = parseTraceContext({});
      const ctx2 = parseTraceContext({});

      expect(ctx1.traceId).not.toBe(ctx2.traceId);
    });
  });

  describe('header key handling', () => {
    it('should find traceparent header (lowercase)', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('should generate new context for non-lowercase traceparent key', () => {
      // Implementation only checks exact match and lowercase key
      const headers = {
        Traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const ctx = parseTraceContext(headers);

      // Should generate new context since key doesn't match
      expect(ctx.traceId).toHaveLength(32);
    });

    it('should find x-frontmcp-trace-id header (lowercase)', () => {
      const headers = {
        'x-frontmcp-trace-id': 'abcd1234abcd1234abcd1234abcd1234',
      };

      const ctx = parseTraceContext(headers);

      expect(ctx.traceId).toBe('abcd1234abcd1234abcd1234abcd1234');
    });

    it('should generate new context for non-lowercase x-frontmcp-trace-id key', () => {
      const headers = {
        'X-FrontMCP-Trace-Id': 'abcd1234abcd1234abcd1234abcd1234',
      };

      const ctx = parseTraceContext(headers);

      // Should generate new context since key doesn't match
      expect(ctx.traceId).toHaveLength(32);
    });
  });
});

describe('generateTraceContext', () => {
  it('should generate valid trace context', () => {
    const ctx = generateTraceContext();

    expect(ctx.traceId).toHaveLength(32);
    expect(ctx.traceId).toMatch(/^[a-f0-9]+$/);
    expect(ctx.parentId).toHaveLength(16);
    expect(ctx.parentId).toMatch(/^[a-f0-9]+$/);
    expect(ctx.traceFlags).toBe(1);
  });

  it('should generate valid raw traceparent header', () => {
    const ctx = generateTraceContext();

    expect(ctx.raw).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(ctx.raw).toBe(`00-${ctx.traceId}-${ctx.parentId}-01`);
  });

  it('should generate unique contexts', () => {
    const contexts = Array.from({ length: 100 }, () => generateTraceContext());
    const traceIds = new Set(contexts.map((c) => c.traceId));
    const parentIds = new Set(contexts.map((c) => c.parentId));

    expect(traceIds.size).toBe(100);
    expect(parentIds.size).toBe(100);
  });

  it('should not generate all-zero IDs', () => {
    // Generate many contexts and check none are all zeros
    for (let i = 0; i < 100; i++) {
      const ctx = generateTraceContext();

      expect(ctx.traceId).not.toBe('00000000000000000000000000000000');
      expect(ctx.parentId).not.toBe('0000000000000000');
    }
  });
});

describe('createChildSpanContext', () => {
  it('should create child context with same trace ID', () => {
    const parent = generateTraceContext();
    const child = createChildSpanContext(parent);

    expect(child.traceId).toBe(parent.traceId);
  });

  it('should create child context with new parent ID', () => {
    const parent = generateTraceContext();
    const child = createChildSpanContext(parent);

    expect(child.parentId).not.toBe(parent.parentId);
    expect(child.parentId).toHaveLength(16);
  });

  it('should preserve trace flags', () => {
    const parent: TraceContext = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      parentId: 'b7ad6b7169203331',
      traceFlags: 0xff,
      raw: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-ff',
    };

    const child = createChildSpanContext(parent);

    expect(child.traceFlags).toBe(0xff);
  });

  it('should generate valid raw traceparent for child', () => {
    const parent = generateTraceContext();
    const child = createChildSpanContext(parent);

    expect(child.raw).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/);
    expect(child.raw).toContain(parent.traceId);
    expect(child.raw).toContain(child.parentId);
  });

  it('should pad single-digit trace flags', () => {
    const parent: TraceContext = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      parentId: 'b7ad6b7169203331',
      traceFlags: 1,
      raw: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    };

    const child = createChildSpanContext(parent);

    expect(child.raw).toMatch(/-01$/);
  });

  it('should create unique children from same parent', () => {
    const parent = generateTraceContext();
    const children = Array.from({ length: 10 }, () => createChildSpanContext(parent));
    const parentIds = new Set(children.map((c) => c.parentId));

    expect(parentIds.size).toBe(10);
    children.forEach((child) => {
      expect(child.traceId).toBe(parent.traceId);
    });
  });

  it('should support creating grandchild spans', () => {
    const parent = generateTraceContext();
    const child = createChildSpanContext(parent);
    const grandchild = createChildSpanContext(child);

    expect(grandchild.traceId).toBe(parent.traceId);
    expect(grandchild.traceId).toBe(child.traceId);
    expect(grandchild.parentId).not.toBe(child.parentId);
    expect(grandchild.parentId).not.toBe(parent.parentId);
  });
});
