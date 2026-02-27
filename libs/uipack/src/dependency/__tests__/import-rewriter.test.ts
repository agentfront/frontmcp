import { rewriteImportsToEsmSh } from '../import-rewriter';

describe('rewriteImportsToEsmSh', () => {
  describe('basic rewrites', () => {
    it('should rewrite default import from react', () => {
      const source = `import React from 'react';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://");
      expect(result.code).not.toContain("from 'react'");
      expect(result.rewrittenCount).toBeGreaterThan(0);
    });

    it('should rewrite named imports from react', () => {
      const source = `import { useState, useEffect } from 'react';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://");
      expect(result.code).not.toContain("from 'react'");
    });

    it('should rewrite react-dom import', () => {
      const source = `import ReactDOM from 'react-dom';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://");
      expect(result.code).not.toContain("from 'react-dom'");
    });

    it('should rewrite scoped package imports', () => {
      const source = `import { Card } from '@frontmcp/ui';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://");
      expect(result.rewrittenCount).toBeGreaterThan(0);
    });
  });

  describe('relative imports', () => {
    it('should leave relative imports untouched', () => {
      const source = `import { helper } from './utils';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toBe(source);
      expect(result.rewrittenCount).toBe(0);
    });

    it('should leave parent directory imports untouched', () => {
      const source = `import { config } from '../config';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toBe(source);
    });

    it('should leave absolute imports untouched', () => {
      const source = `import { module } from '/absolute/path';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toBe(source);
    });
  });

  describe('fallback for unknown packages', () => {
    it('should use esm.sh fallback for unknown packages', () => {
      const source = `import something from 'unknown-package';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://esm.sh/unknown-package'");
      expect(result.fallbackPackages).toContain('unknown-package');
    });

    it('should use custom fallback CDN base', () => {
      const source = `import something from 'my-pkg';`;
      const result = rewriteImportsToEsmSh(source, {
        fallbackCdnBase: 'https://cdn.example.com',
      });

      expect(result.code).toContain("from 'https://cdn.example.com/my-pkg'");
    });
  });

  describe('skip packages', () => {
    it('should skip specified packages', () => {
      const source = `import React from 'react';\nimport foo from 'bar';`;
      const result = rewriteImportsToEsmSh(source, {
        skipPackages: ['react'],
      });

      expect(result.code).toContain("from 'react'");
      expect(result.code).toContain("from 'https://esm.sh/bar'");
    });
  });

  describe('overrides', () => {
    it('should use override URLs', () => {
      const source = `import React from 'react';`;
      const result = rewriteImportsToEsmSh(source, {
        overrides: { react: 'https://custom.cdn/react@18' },
      });

      expect(result.code).toContain("from 'https://custom.cdn/react@18'");
    });

    it('should handle package-level overrides with subpath', () => {
      const source = `import { createRoot } from 'react-dom/client';`;
      const result = rewriteImportsToEsmSh(source, {
        overrides: { 'react-dom': 'https://custom.cdn/react-dom@18' },
      });

      expect(result.code).toContain("from 'https://custom.cdn/react-dom@18/client'");
    });
  });

  describe('mixed imports', () => {
    it('should handle multiple import types in one file', () => {
      const source = `
import React from 'react';
import { useState } from 'react';
import { Card } from './components/Card';
import * as d3 from 'd3';
import 'chart.js';
`;
      const result = rewriteImportsToEsmSh(source);

      // External imports should be rewritten
      expect(result.code).not.toMatch(/from 'react'/);
      expect(result.code).not.toMatch(/from 'd3'/);

      // Relative imports should be preserved
      expect(result.code).toContain("from './components/Card'");

      expect(result.rewrittenCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('double quotes', () => {
    it('should handle double-quoted imports', () => {
      const source = `import React from "react";`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain('from "https://');
      expect(result.code).not.toContain('from "react"');
    });
  });

  describe('dynamic imports', () => {
    it('should rewrite dynamic imports', () => {
      const source = `const mod = await import('lodash');`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("import('https://");
      expect(result.code).not.toContain("import('lodash')");
    });
  });

  describe('re-exports', () => {
    it('should rewrite re-exports', () => {
      const source = `export { foo } from 'react';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://");
      expect(result.code).not.toContain("from 'react'");
    });

    it('should rewrite export * from', () => {
      const source = `export * from 'react';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.code).toContain("from 'https://");
    });
  });

  describe('result metadata', () => {
    it('should return rewrites map', () => {
      const source = `import React from 'react';`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.rewrites.size).toBeGreaterThan(0);
      expect(result.rewrites.has('react')).toBe(true);
    });

    it('should return empty for no-op source', () => {
      const source = `const x = 1;`;
      const result = rewriteImportsToEsmSh(source);

      expect(result.rewrittenCount).toBe(0);
      expect(result.rewrites.size).toBe(0);
      expect(result.fallbackPackages).toHaveLength(0);
      expect(result.code).toBe(source);
    });
  });

  describe('node built-ins', () => {
    it('should leave node: protocol imports untouched', () => {
      const source = `import { readFile } from 'node:fs/promises';`;
      const result = rewriteImportsToEsmSh(source);

      // node: imports are external but start with 'node:', so should be skipped
      expect(result.code).toBe(source);
    });
  });
});
