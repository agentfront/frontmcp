/**
 * Template Validator Tests
 *
 * Tests for validating Handlebars templates against Zod schemas.
 */

import { z } from 'zod';
import {
  validateTemplate,
  formatValidationWarnings,
  assertTemplateValid,
  isTemplateValid,
  getMissingFields,
} from './template-validator';

describe('validateTemplate', () => {
  describe('valid templates', () => {
    it('should return valid=true for templates with existing fields', () => {
      const template = '<div>{{output.temperature}}</div>';
      const schema = z.object({ temperature: z.number() });

      const result = validateTemplate(template, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle nested field access', () => {
      const template = '<div>{{output.user.name}}</div>';
      const schema = z.object({
        user: z.object({
          name: z.string(),
        }),
      });

      const result = validateTemplate(template, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle array field access', () => {
      const template = '{{#each output.items}}{{output.items.[].name}}{{/each}}';
      const schema = z.object({
        items: z.array(z.object({ name: z.string() })),
      });

      const result = validateTemplate(template, schema);

      expect(result.valid).toBe(true);
    });
  });

  describe('invalid templates', () => {
    it('should detect missing fields', () => {
      const template = '<div>{{output.temperature}} {{output.city}}</div>';
      const schema = z.object({ temperature: z.number() });

      const result = validateTemplate(template, schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('output.city');
      expect(result.errors[0].type).toBe('missing_field');
    });

    it('should detect missing nested fields', () => {
      const template = '<div>{{output.user.email}}</div>';
      const schema = z.object({
        user: z.object({
          name: z.string(),
        }),
      });

      const result = validateTemplate(template, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'output.user.email')).toBe(true);
    });

    it('should detect completely invalid root paths', () => {
      const template = '<div>{{output.invalid.deep.path}}</div>';
      const schema = z.object({ name: z.string() });

      const result = validateTemplate(template, schema);

      expect(result.valid).toBe(false);
    });
  });

  describe('suggestions', () => {
    it('should suggest similar paths for typos', () => {
      const template = '<div>{{output.temperatur}}</div>';
      const schema = z.object({ temperature: z.number() });

      const result = validateTemplate(template, schema, { suggestSimilar: true });

      expect(result.valid).toBe(false);
      expect(result.errors[0].suggestions).toContain('output.temperature');
    });

    it('should not suggest when suggestSimilar is false', () => {
      const template = '<div>{{output.temperatur}}</div>';
      const schema = z.object({ temperature: z.number() });

      const result = validateTemplate(template, schema, { suggestSimilar: false });

      expect(result.errors[0].suggestions).toHaveLength(0);
    });
  });

  describe('input schema validation', () => {
    it('should skip input paths when no inputSchema provided', () => {
      const template = '<div>{{input.query}}</div>';
      const outputSchema = z.object({ result: z.string() });

      const result = validateTemplate(template, outputSchema);

      expect(result.valid).toBe(true); // No errors since input paths are skipped
    });

    it('should validate input paths when inputSchema provided', () => {
      const template = '<div>{{input.query}} {{input.invalidField}}</div>';
      const outputSchema = z.object({ result: z.string() });
      const inputSchema = z.object({ query: z.string() });

      const result = validateTemplate(template, outputSchema, { inputSchema });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'input.invalidField')).toBe(true);
    });
  });

  describe('optional field warnings', () => {
    it('should warn about optional fields without guards when warnOnOptional is true', () => {
      const template = '<div>{{output.email}}</div>';
      const schema = z.object({ email: z.string().optional() });

      const result = validateTemplate(template, schema, { warnOnOptional: true });

      expect(result.valid).toBe(true); // Still valid
      expect(result.warnings.some((w) => w.type === 'optional_field')).toBe(true);
    });

    it('should not warn when optional field has guard', () => {
      const template = '{{#if output.email}}<div>{{output.email}}</div>{{/if}}';
      const schema = z.object({ email: z.string().optional() });

      const result = validateTemplate(template, schema, { warnOnOptional: true });

      expect(result.warnings.filter((w) => w.type === 'optional_field')).toHaveLength(0);
    });
  });

  describe('templatePaths and schemaPaths', () => {
    it('should return all template paths', () => {
      const template = '{{output.a}} {{output.b}} {{output.c}}';
      const schema = z.object({ a: z.string(), b: z.number() });

      const result = validateTemplate(template, schema);

      expect(result.templatePaths).toContain('output.a');
      expect(result.templatePaths).toContain('output.b');
      expect(result.templatePaths).toContain('output.c');
    });

    it('should return all schema paths', () => {
      const template = '{{output.a}}';
      const schema = z.object({
        a: z.string(),
        b: z.number(),
        c: z.boolean(),
      });

      const result = validateTemplate(template, schema);

      expect(result.schemaPaths).toContain('output.a');
      expect(result.schemaPaths).toContain('output.b');
      expect(result.schemaPaths).toContain('output.c');
    });
  });
});

describe('formatValidationWarnings', () => {
  it('should format errors nicely', () => {
    const template = '<div>{{output.city}}</div>';
    const schema = z.object({ temperature: z.number() });
    const result = validateTemplate(template, schema);

    const formatted = formatValidationWarnings(result, 'test-tool');

    expect(formatted).toContain('test-tool');
    expect(formatted).toContain('output.city');
    expect(formatted).toContain('does not exist');
  });

  it('should include suggestions', () => {
    const template = '<div>{{output.temperatur}}</div>';
    const schema = z.object({ temperature: z.number() });
    const result = validateTemplate(template, schema);

    const formatted = formatValidationWarnings(result, 'test-tool');

    expect(formatted).toContain('Did you mean');
    expect(formatted).toContain('output.temperature');
  });

  it('should return empty string for valid templates', () => {
    const template = '<div>{{output.name}}</div>';
    const schema = z.object({ name: z.string() });
    const result = validateTemplate(template, schema);

    const formatted = formatValidationWarnings(result, 'test-tool');

    expect(formatted).toBe('');
  });
});

describe('assertTemplateValid', () => {
  it('should not throw for valid templates', () => {
    const template = '<div>{{output.name}}</div>';
    const schema = z.object({ name: z.string() });

    expect(() => assertTemplateValid(template, schema, 'test-tool')).not.toThrow();
  });

  it('should throw for invalid templates', () => {
    const template = '<div>{{output.invalid}}</div>';
    const schema = z.object({ name: z.string() });

    expect(() => assertTemplateValid(template, schema, 'test-tool')).toThrow(/Template validation failed/);
  });

  it('should include tool name in error message', () => {
    const template = '<div>{{output.invalid}}</div>';
    const schema = z.object({ name: z.string() });

    expect(() => assertTemplateValid(template, schema, 'my-tool')).toThrow(/my-tool/);
  });
});

describe('isTemplateValid', () => {
  it('should return true for valid templates', () => {
    const template = '<div>{{output.name}}</div>';
    const schema = z.object({ name: z.string() });

    expect(isTemplateValid(template, schema)).toBe(true);
  });

  it('should return false for invalid templates', () => {
    const template = '<div>{{output.invalid}}</div>';
    const schema = z.object({ name: z.string() });

    expect(isTemplateValid(template, schema)).toBe(false);
  });
});

describe('getMissingFields', () => {
  it('should return array of missing field paths', () => {
    const template = '<div>{{output.a}} {{output.b}} {{output.c}}</div>';
    const schema = z.object({ a: z.string() });

    const missing = getMissingFields(template, schema);

    expect(missing).toContain('output.b');
    expect(missing).toContain('output.c');
    expect(missing).not.toContain('output.a');
  });

  it('should return empty array when all fields exist', () => {
    const template = '<div>{{output.name}}</div>';
    const schema = z.object({ name: z.string() });

    const missing = getMissingFields(template, schema);

    expect(missing).toHaveLength(0);
  });
});
