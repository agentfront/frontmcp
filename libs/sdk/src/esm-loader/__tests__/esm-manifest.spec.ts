import { normalizeEsmExport, frontMcpPackageManifestSchema } from '../esm-manifest';

describe('normalizeEsmExport', () => {
  describe('plain manifest object via default export', () => {
    it('should normalize a valid manifest from default export', () => {
      const moduleExport = {
        default: {
          name: '@acme/tools',
          version: '1.0.0',
          description: 'Test tools',
          tools: [{ name: 'my-tool', execute: jest.fn() }],
        },
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('@acme/tools');
      expect(result.version).toBe('1.0.0');
      expect(result.tools).toHaveLength(1);
    });

    it('should handle manifest without optional fields', () => {
      const moduleExport = {
        default: {
          name: 'minimal',
          version: '0.1.0',
        },
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('minimal');
      expect(result.version).toBe('0.1.0');
      expect(result.tools).toBeUndefined();
    });
  });

  describe('named exports', () => {
    it('should collect named exports into a manifest', () => {
      const moduleExport = {
        name: 'named-pkg',
        version: '2.0.0',
        tools: [{ name: 'tool-a' }],
        prompts: [{ name: 'prompt-a' }],
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('named-pkg');
      expect(result.tools).toHaveLength(1);
      expect(result.prompts).toHaveLength(1);
    });

    it('should handle module with only primitive arrays (no name/version)', () => {
      const moduleExport = {
        tools: [{ name: 'tool-a' }],
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('unknown');
      expect(result.version).toBe('0.0.0');
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('error cases', () => {
    it('should throw for null export', () => {
      expect(() => normalizeEsmExport(null)).toThrow('must be an object');
    });

    it('should throw for undefined export', () => {
      expect(() => normalizeEsmExport(undefined)).toThrow('must be an object');
    });

    it('should throw for primitive export', () => {
      expect(() => normalizeEsmExport('string')).toThrow('must be an object');
    });

    it('should throw for empty object with no recognizable structure', () => {
      expect(() => normalizeEsmExport({})).toThrow('does not export a valid');
    });
  });
});

describe('frontMcpPackageManifestSchema', () => {
  it('should validate a complete manifest', () => {
    const result = frontMcpPackageManifestSchema.safeParse({
      name: 'test',
      version: '1.0.0',
      tools: [],
      prompts: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject manifest without name', () => {
    const result = frontMcpPackageManifestSchema.safeParse({
      version: '1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('should reject manifest without version', () => {
    const result = frontMcpPackageManifestSchema.safeParse({
      name: 'test',
    });
    expect(result.success).toBe(false);
  });
});
