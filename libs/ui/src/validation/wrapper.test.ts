import { z } from 'zod';
import { validateOptions, withValidation } from './wrapper';

describe('validateOptions', () => {
  // Test schema
  const testSchema = z
    .object({
      name: z.string(),
      age: z.number().optional(),
      email: z.string().email().optional(),
    })
    .strict();

  describe('successful validation', () => {
    it('should return success for valid input', () => {
      const result = validateOptions(
        { name: 'Test' },
        {
          componentName: 'Test',
          schema: testSchema,
        },
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'Test' });
      }
    });

    it('should return success with all valid fields', () => {
      const result = validateOptions(
        { name: 'Test', age: 25, email: 'test@example.com' },
        { componentName: 'Test', schema: testSchema },
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'Test', age: 25, email: 'test@example.com' });
      }
    });

    it('should return parsed/transformed data', () => {
      const schemaWithTransform = z.object({
        count: z.string().transform((v) => parseInt(v, 10)),
      });
      const result = validateOptions({ count: '42' }, { componentName: 'Test', schema: schemaWithTransform });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ count: 42 });
      }
    });
  });

  describe('failed validation', () => {
    it('should return error HTML for invalid input type', () => {
      const result = validateOptions(
        { name: 123 },
        {
          componentName: 'Test',
          schema: testSchema,
        },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-testid="validation-error"');
        expect(result.error).toContain('data-component="Test"');
      }
    });

    it('should return error HTML for missing required field', () => {
      const result = validateOptions(
        {},
        {
          componentName: 'Test',
          schema: testSchema,
        },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-param="name"');
      }
    });

    it('should identify invalid param path', () => {
      const result = validateOptions(
        { name: 123 },
        {
          componentName: 'Test',
          schema: testSchema,
        },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-param="name"');
      }
    });

    it('should reject unknown properties with strict schema', () => {
      const result = validateOptions(
        { name: 'Test', unknownProp: 'value' },
        { componentName: 'Test', schema: testSchema },
      );
      expect(result.success).toBe(false);
    });

    it('should show first error when multiple fields are invalid', () => {
      const multiFieldSchema = z.object({
        field1: z.string(),
        field2: z.number(),
        field3: z.boolean(),
      });
      const result = validateOptions(
        { field1: 123, field2: 'not a number', field3: 'not a bool' },
        { componentName: 'Test', schema: multiFieldSchema },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        // Should show first invalid field
        expect(result.error).toContain('data-param="field1"');
      }
    });
  });

  describe('nested validation', () => {
    const nestedSchema = z.object({
      config: z.object({
        value: z.string(),
        nested: z.object({
          deep: z.number(),
        }),
      }),
    });

    it('should identify nested invalid param path', () => {
      const result = validateOptions({ config: { value: 123 } }, { componentName: 'Test', schema: nestedSchema });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-param="config.value"');
      }
    });

    it('should identify deeply nested invalid param path', () => {
      const result = validateOptions(
        { config: { value: 'test', nested: { deep: 'not a number' } } },
        { componentName: 'Test', schema: nestedSchema },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-param="config.nested.deep"');
      }
    });
  });

  describe('array validation', () => {
    const arraySchema = z.object({
      items: z.array(z.string()),
    });

    it('should validate arrays successfully', () => {
      const result = validateOptions({ items: ['a', 'b', 'c'] }, { componentName: 'Test', schema: arraySchema });
      expect(result.success).toBe(true);
    });

    it('should identify invalid array element', () => {
      const result = validateOptions({ items: ['a', 123, 'c'] }, { componentName: 'Test', schema: arraySchema });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-param="items.1"');
      }
    });
  });

  describe('enum validation', () => {
    const enumSchema = z.object({
      variant: z.enum(['primary', 'secondary', 'danger']),
    });

    it('should accept valid enum value', () => {
      const result = validateOptions({ variant: 'primary' }, { componentName: 'Button', schema: enumSchema });
      expect(result.success).toBe(true);
    });

    it('should reject invalid enum value', () => {
      const result = validateOptions({ variant: 'invalid-variant' }, { componentName: 'Button', schema: enumSchema });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-param="variant"');
      }
    });
  });

  describe('component name handling', () => {
    it('should include component name in error', () => {
      const result = validateOptions(
        { name: 123 },
        {
          componentName: 'MyCustomButton',
          schema: testSchema,
        },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('data-component="MyCustomButton"');
        expect(result.error).toContain('MyCustomButton: Invalid Configuration');
      }
    });
  });
});

describe('withValidation', () => {
  const testSchema = z
    .object({
      variant: z.enum(['primary', 'secondary']),
    })
    .strict();

  const mockComponent = jest.fn((text: string, opts: { variant: string }) => {
    return `<div class="${opts.variant}">${text}</div>`;
  });

  beforeEach(() => {
    mockComponent.mockClear();
  });

  it('should call component with validated data on success', () => {
    const wrapped = withValidation(mockComponent, {
      componentName: 'Test',
      schema: testSchema,
    });

    const result = wrapped('Hello', { variant: 'primary' });

    expect(mockComponent).toHaveBeenCalledWith('Hello', { variant: 'primary' });
    expect(result).toBe('<div class="primary">Hello</div>');
  });

  it('should return error box without calling component on failure', () => {
    const wrapped = withValidation(mockComponent, {
      componentName: 'Test',
      schema: testSchema,
    });

    const result = wrapped('Hello', { variant: 'invalid' });

    expect(mockComponent).not.toHaveBeenCalled();
    expect(result).toContain('data-testid="validation-error"');
  });

  it('should reject unknown properties', () => {
    const wrapped = withValidation(mockComponent, {
      componentName: 'Test',
      schema: testSchema,
    });

    const result = wrapped('Hello', { variant: 'primary', unknownProp: 'value' });

    expect(mockComponent).not.toHaveBeenCalled();
    expect(result).toContain('data-testid="validation-error"');
  });

  it('should pass through input parameter unchanged', () => {
    const wrapped = withValidation(mockComponent, {
      componentName: 'Test',
      schema: testSchema,
    });

    wrapped('Test Input', { variant: 'secondary' });

    expect(mockComponent).toHaveBeenCalledWith('Test Input', { variant: 'secondary' });
  });

  it('should include component name in error', () => {
    const wrapped = withValidation(mockComponent, {
      componentName: 'CustomComponent',
      schema: testSchema,
    });

    const result = wrapped('Hello', { variant: 'invalid' });

    expect(result).toContain('data-component="CustomComponent"');
    expect(result).toContain('CustomComponent: Invalid Configuration');
  });
});
