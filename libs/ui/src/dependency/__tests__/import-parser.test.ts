/**
 * Import Parser Tests
 *
 * Tests for extracting imports from source code.
 */

import {
  parseImports,
  extractExternalPackages,
  filterImportsByPackages,
  getImportStats,
  getPackageName,
} from '../import-parser';

describe('Import Parser', () => {
  describe('parseImports', () => {
    it('should parse named imports', () => {
      const source = `import { useState, useEffect } from 'react';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('react');
      expect(result.imports[0].type).toBe('named');
      expect(result.imports[0].namedImports).toContain('useState');
      expect(result.imports[0].namedImports).toContain('useEffect');
    });

    it('should parse default imports', () => {
      const source = `import React from 'react';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('react');
      expect(result.imports[0].type).toBe('default');
      expect(result.imports[0].defaultImport).toBe('React');
    });

    it('should parse namespace imports', () => {
      const source = `import * as d3 from 'd3';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('d3');
      expect(result.imports[0].type).toBe('namespace');
      expect(result.imports[0].namespaceImport).toBe('d3');
    });

    it('should parse side-effect imports', () => {
      const source = `import 'chart.js/auto';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('chart.js/auto');
      expect(result.imports[0].type).toBe('side-effect');
    });

    it('should parse dynamic imports', () => {
      const source = `const module = await import('lodash');`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('lodash');
      expect(result.imports[0].type).toBe('dynamic');
    });

    it('should parse mixed default and named imports', () => {
      const source = `import React, { useState } from 'react';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('react');
      // Mixed imports should be parsed as named (primary)
      expect(result.imports[0].namedImports).toContain('useState');
    });

    it('should handle multiple imports', () => {
      const source = `
        import React from 'react';
        import { Chart } from 'chart.js';
        import * as d3 from 'd3';
      `;
      const result = parseImports(source);

      expect(result.imports.length).toBe(3);
      expect(result.externalPackages).toContain('react');
      expect(result.externalPackages).toContain('chart.js');
      expect(result.externalPackages).toContain('d3');
    });

    it('should distinguish external and relative imports', () => {
      const source = `
        import React from 'react';
        import { helper } from './utils';
        import { component } from '../shared/component';
      `;
      const result = parseImports(source);

      expect(result.externalImports.length).toBe(1);
      expect(result.relativeImports.length).toBe(2);
      expect(result.externalPackages).toEqual(['react']);
    });

    it('should handle scoped packages', () => {
      const source = `import { something } from '@org/package';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      expect(result.imports[0].specifier).toBe('@org/package');
      expect(result.externalPackages).toContain('@org/package');
    });

    it('should include line and column information', () => {
      const source = `import React from 'react';`;
      const result = parseImports(source);

      expect(result.imports[0].line).toBeGreaterThan(0);
      expect(result.imports[0].column).toBeGreaterThanOrEqual(0);
    });

    it('should handle imports with aliases', () => {
      const source = `import { useState as state, useEffect as effect } from 'react';`;
      const result = parseImports(source);

      expect(result.imports.length).toBe(1);
      // The parser should capture the original import names
      expect(result.imports[0].namedImports).toContain('useState');
      expect(result.imports[0].namedImports).toContain('useEffect');
    });

    it('should handle empty source', () => {
      const result = parseImports('');
      expect(result.imports).toEqual([]);
      expect(result.externalPackages).toEqual([]);
    });

    it('should handle source without imports', () => {
      const source = `const x = 1; console.log(x);`;
      const result = parseImports(source);
      expect(result.imports).toEqual([]);
    });
  });

  describe('extractExternalPackages', () => {
    it('should extract unique external package names', () => {
      const source = `
        import React from 'react';
        import { useState } from 'react';
        import { Chart } from 'chart.js';
        import { helper } from './utils';
      `;
      const packages = extractExternalPackages(source);

      expect(packages).toContain('react');
      expect(packages).toContain('chart.js');
      expect(packages).not.toContain('./utils');
      // Should be deduped
      expect(packages.filter((p) => p === 'react').length).toBe(1);
    });

    it('should extract package names from subpaths', () => {
      const source = `import { something } from 'lodash/fp';`;
      const packages = extractExternalPackages(source);
      expect(packages).toContain('lodash');
    });
  });

  describe('filterImportsByPackages', () => {
    it('should filter imports by package list', () => {
      const source = `
        import React from 'react';
        import { Chart } from 'chart.js';
        import lodash from 'lodash';
      `;
      const result = parseImports(source);
      // filterImportsByPackages takes the full result, not just imports array
      const filtered = filterImportsByPackages(result, ['react', 'lodash']);

      expect(filtered.length).toBe(2);
      expect(filtered.map((i) => i.specifier)).toContain('react');
      expect(filtered.map((i) => i.specifier)).toContain('lodash');
      expect(filtered.map((i) => i.specifier)).not.toContain('chart.js');
    });
  });

  describe('getImportStats', () => {
    it('should return import statistics', () => {
      const source = `
        import React from 'react';
        import { Chart } from 'chart.js';
        import * as d3 from 'd3';
        import { helper } from './utils';
      `;
      // getImportStats takes source code, not parsed result
      const stats = getImportStats(source);

      expect(stats.total).toBe(4);
      expect(stats.external).toBe(3);
      expect(stats.relative).toBe(1);
      expect(stats.byType.named).toBeGreaterThanOrEqual(1);
      expect(stats.byType.default).toBeGreaterThanOrEqual(1);
      expect(stats.byType.namespace).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getPackageName', () => {
    it('should extract package name from bare specifier', () => {
      expect(getPackageName('react')).toBe('react');
      expect(getPackageName('lodash')).toBe('lodash');
    });

    it('should extract package name from subpath', () => {
      expect(getPackageName('lodash/fp')).toBe('lodash');
      expect(getPackageName('chart.js/auto')).toBe('chart.js');
    });

    it('should handle scoped packages', () => {
      expect(getPackageName('@org/package')).toBe('@org/package');
      expect(getPackageName('@org/package/subpath')).toBe('@org/package');
    });

    it('should return first path segment for relative paths', () => {
      // getPackageName extracts first segment, doesn't distinguish relative paths
      // Use parseImports + externalPackages for proper filtering
      expect(getPackageName('./utils')).toBe('.');
      expect(getPackageName('../shared/component')).toBe('..');
    });
  });
});
