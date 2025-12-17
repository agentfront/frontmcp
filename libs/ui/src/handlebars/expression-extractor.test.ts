/**
 * Expression Extractor Tests
 *
 * Tests for extracting Handlebars expressions from templates.
 */

import {
  extractExpressions,
  extractVariablePaths,
  extractOutputPaths,
  extractInputPaths,
  extractStructuredContentPaths,
  extractAll,
  hasVariablePaths,
  getExpressionAt,
  normalizePath,
  type ExtractedExpression,
} from './expression-extractor';

describe('extractExpressions', () => {
  it('should extract simple variable expressions', () => {
    const template = '<div>{{output.name}}</div>';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(1);
    expect(expressions[0].path).toBe('output.name');
    expect(expressions[0].type).toBe('variable');
    expect(expressions[0].fullExpression).toBe('{{output.name}}');
  });

  it('should extract multiple expressions', () => {
    const template = '<div>{{output.name}} - {{output.value}}</div>';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(2);
    expect(expressions[0].path).toBe('output.name');
    expect(expressions[1].path).toBe('output.value');
  });

  it('should extract nested paths', () => {
    const template = '{{output.user.profile.name}}';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(1);
    expect(expressions[0].path).toBe('output.user.profile.name');
  });

  it('should extract input paths', () => {
    const template = '{{input.query}} - {{input.filter.type}}';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(2);
    expect(expressions[0].path).toBe('input.query');
    expect(expressions[1].path).toBe('input.filter.type');
  });

  it('should extract structuredContent paths', () => {
    const template = '{{structuredContent.items}}';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(1);
    expect(expressions[0].path).toBe('structuredContent.items');
  });

  it('should handle block helpers', () => {
    const template = '{{#if output.visible}}<div>Content</div>{{/if}}';
    const expressions = extractExpressions(template);

    const outputExpr = expressions.find((e) => e.path === 'output.visible');
    expect(outputExpr).toBeDefined();
    expect(outputExpr?.type).toBe('block');
    expect(outputExpr?.helperName).toBe('if');
  });

  it('should handle each loops', () => {
    const template = '{{#each output.items}}{{output.items.name}}{{/each}}';
    const expressions = extractExpressions(template);

    expect(expressions.some((e) => e.path === 'output.items')).toBe(true);
  });

  it('should track line and column numbers', () => {
    const template = '<div>\n  {{output.name}}\n</div>';
    const expressions = extractExpressions(template);

    expect(expressions[0].line).toBe(2);
    expect(expressions[0].column).toBe(3);
  });

  it('should ignore comments', () => {
    const template = '{{! This is a comment }} {{output.name}}';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(1);
    expect(expressions[0].path).toBe('output.name');
  });

  it('should handle triple braces (unescaped)', () => {
    const template = '{{{output.html}}}';
    const expressions = extractExpressions(template);

    expect(expressions).toHaveLength(1);
    expect(expressions[0].path).toBe('output.html');
  });
});

describe('extractVariablePaths', () => {
  it('should return unique paths', () => {
    const template = '{{output.name}} {{output.name}} {{output.value}}';
    const paths = extractVariablePaths(template);

    expect(paths).toHaveLength(2);
    expect(paths).toContain('output.name');
    expect(paths).toContain('output.value');
  });
});

describe('extractOutputPaths', () => {
  it('should only return output.* paths', () => {
    const template = '{{output.a}} {{input.b}} {{output.c}}';
    const paths = extractOutputPaths(template);

    expect(paths).toHaveLength(2);
    expect(paths).toContain('output.a');
    expect(paths).toContain('output.c');
    expect(paths).not.toContain('input.b');
  });
});

describe('extractInputPaths', () => {
  it('should only return input.* paths', () => {
    const template = '{{output.a}} {{input.b}} {{input.c}}';
    const paths = extractInputPaths(template);

    expect(paths).toHaveLength(2);
    expect(paths).toContain('input.b');
    expect(paths).toContain('input.c');
    expect(paths).not.toContain('output.a');
  });
});

describe('extractStructuredContentPaths', () => {
  it('should only return structuredContent.* paths', () => {
    const template = '{{output.a}} {{structuredContent.items}}';
    const paths = extractStructuredContentPaths(template);

    expect(paths).toHaveLength(1);
    expect(paths).toContain('structuredContent.items');
  });
});

describe('extractAll', () => {
  it('should return categorized paths', () => {
    const template = '{{output.a}} {{input.b}} {{structuredContent.c}}';
    const result = extractAll(template);

    expect(result.paths).toHaveLength(3);
    expect(result.outputPaths).toContain('output.a');
    expect(result.inputPaths).toContain('input.b');
    expect(result.structuredContentPaths).toContain('structuredContent.c');
  });
});

describe('hasVariablePaths', () => {
  it('should return true for templates with paths', () => {
    expect(hasVariablePaths('{{output.name}}')).toBe(true);
  });

  it('should return false for templates without paths', () => {
    expect(hasVariablePaths('<div>Hello World</div>')).toBe(false);
  });

  it('should return false for templates with only keywords', () => {
    expect(hasVariablePaths('{{this}}')).toBe(false);
  });
});

describe('getExpressionAt', () => {
  it('should find expression at given position', () => {
    const template = '<div>{{output.name}}</div>';
    const expr = getExpressionAt(template, 1, 10);

    expect(expr).toBeDefined();
    expect(expr?.path).toBe('output.name');
  });

  it('should return undefined for position outside expressions', () => {
    const template = '<div>{{output.name}}</div>';
    const expr = getExpressionAt(template, 1, 1);

    expect(expr).toBeUndefined();
  });
});

describe('normalizePath', () => {
  it('should convert numeric indices to []', () => {
    expect(normalizePath('output.items.0.name')).toBe('output.items.[].name');
  });

  it('should handle multiple indices', () => {
    expect(normalizePath('output.items.0.children.1.value')).toBe('output.items.[].children.[].value');
  });

  it('should handle index at end', () => {
    expect(normalizePath('output.items.0')).toBe('output.items.[]');
  });

  it('should handle bracket notation', () => {
    expect(normalizePath('output.items[0].name')).toBe('output.items.[].name');
  });

  it('should leave non-numeric paths unchanged', () => {
    expect(normalizePath('output.user.name')).toBe('output.user.name');
  });
});
