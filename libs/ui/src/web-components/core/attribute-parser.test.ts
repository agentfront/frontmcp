/**
 * @file attribute-parser.test.ts
 * @description Tests for attribute parsing utilities.
 */

import {
  parseAttributeValue,
  kebabToCamel,
  camelToKebab,
  getObservedAttributesFromSchema,
  mergeAttributeIntoOptions,
  type ParsedAttribute,
} from './attribute-parser';
import { z } from 'zod';

describe('Attribute Parser', () => {
  describe('kebabToCamel', () => {
    it('should convert simple kebab-case to camelCase', () => {
      expect(kebabToCamel('full-width')).toBe('fullWidth');
    });

    it('should convert multiple dashes', () => {
      expect(kebabToCamel('icon-before-text')).toBe('iconBeforeText');
    });

    it('should handle single word', () => {
      expect(kebabToCamel('variant')).toBe('variant');
    });

    it('should handle empty string', () => {
      expect(kebabToCamel('')).toBe('');
    });
  });

  describe('camelToKebab', () => {
    it('should convert simple camelCase to kebab-case', () => {
      expect(camelToKebab('fullWidth')).toBe('full-width');
    });

    it('should convert multiple uppercase letters', () => {
      expect(camelToKebab('iconBeforeText')).toBe('icon-before-text');
    });

    it('should handle single word', () => {
      expect(camelToKebab('variant')).toBe('variant');
    });

    it('should handle empty string', () => {
      expect(camelToKebab('')).toBe('');
    });
  });

  describe('parseAttributeValue', () => {
    describe('basic values', () => {
      it('should parse string values', () => {
        const result = parseAttributeValue('variant', 'primary');
        expect(result).toEqual({ key: 'variant', value: 'primary' });
      });

      it('should convert kebab-case attribute names to camelCase', () => {
        const result = parseAttributeValue('full-width', 'true');
        expect(result.key).toBe('fullWidth');
      });
    });

    describe('boolean values', () => {
      it('should parse presence attribute as true', () => {
        const result = parseAttributeValue('disabled', null);
        expect(result).toEqual({ key: 'disabled', value: true });
      });

      it('should parse empty string attribute as true', () => {
        const result = parseAttributeValue('disabled', '');
        expect(result).toEqual({ key: 'disabled', value: true });
      });

      it('should parse "true" string as boolean true', () => {
        const result = parseAttributeValue('disabled', 'true');
        expect(result).toEqual({ key: 'disabled', value: true });
      });

      it('should parse "false" string as boolean false', () => {
        const result = parseAttributeValue('disabled', 'false');
        expect(result).toEqual({ key: 'disabled', value: false });
      });
    });

    describe('numeric values', () => {
      it('should parse integer strings as numbers', () => {
        const result = parseAttributeValue('max', '100');
        expect(result).toEqual({ key: 'max', value: 100 });
      });

      it('should parse float strings as numbers', () => {
        const result = parseAttributeValue('step', '0.5');
        expect(result).toEqual({ key: 'step', value: 0.5 });
      });

      it('should parse negative numbers', () => {
        const result = parseAttributeValue('min', '-10');
        expect(result).toEqual({ key: 'min', value: -10 });
      });

      it('should not parse non-numeric strings as numbers', () => {
        const result = parseAttributeValue('name', 'abc123');
        expect(result).toEqual({ key: 'name', value: 'abc123' });
      });
    });

    describe('JSON values', () => {
      it('should parse JSON objects', () => {
        const json = '{"key":"value"}';
        const result = parseAttributeValue('options', json);
        expect(result).toEqual({ key: 'options', value: { key: 'value' } });
      });

      it('should parse JSON arrays', () => {
        const json = '["a","b","c"]';
        const result = parseAttributeValue('items', json);
        expect(result).toEqual({ key: 'items', value: ['a', 'b', 'c'] });
      });

      it('should fallback to string for invalid JSON', () => {
        const result = parseAttributeValue('options', '{invalid}');
        expect(result).toEqual({ key: 'options', value: '{invalid}' });
      });
    });

    describe('data attributes', () => {
      it('should parse data-* as data nested object', () => {
        const result = parseAttributeValue('data-action', 'submit');
        expect(result).toEqual({
          key: 'action',
          value: 'submit',
          isData: true,
        });
      });

      it('should parse data-id as data nested object', () => {
        const result = parseAttributeValue('data-id', '123');
        expect(result).toEqual({
          key: 'id',
          value: '123',
          isData: true,
        });
      });

      it('should handle null value for data attribute', () => {
        const result = parseAttributeValue('data-flag', null);
        expect(result).toEqual({
          key: 'flag',
          value: '',
          isData: true,
        });
      });
    });

    describe('internal attributes', () => {
      it('should skip data-fmcp-* attributes', () => {
        const result = parseAttributeValue('data-fmcp-internal', 'value');
        expect(result).toEqual({ key: null, value: undefined });
      });
    });
  });

  describe('mergeAttributeIntoOptions', () => {
    it('should merge simple attribute into empty options', () => {
      const options = {};
      const parsed: ParsedAttribute = { key: 'variant', value: 'primary' };
      const result = mergeAttributeIntoOptions(options, parsed);
      expect(result).toEqual({ variant: 'primary' });
    });

    it('should merge simple attribute into existing options', () => {
      const options = { size: 'md' };
      const parsed: ParsedAttribute = { key: 'variant', value: 'primary' };
      const result = mergeAttributeIntoOptions(options, parsed);
      expect(result).toEqual({ variant: 'primary', size: 'md' });
    });

    it('should merge data attribute into nested data object', () => {
      const options = {};
      const parsed: ParsedAttribute = { key: 'id', value: '123', isData: true };
      const result = mergeAttributeIntoOptions(options, parsed);
      expect(result).toEqual({ data: { id: '123' } });
    });

    it('should skip null key', () => {
      const options = { existing: 'value' };
      const parsed: ParsedAttribute = { key: null, value: undefined };
      const result = mergeAttributeIntoOptions(options, parsed);
      expect(result).toEqual({ existing: 'value' });
    });

    it('should skip undefined value', () => {
      const options = { existing: 'value' };
      const parsed: ParsedAttribute = { key: 'other', value: undefined };
      const result = mergeAttributeIntoOptions(options, parsed);
      expect(result).toEqual({ existing: 'value' });
    });
  });

  describe('getObservedAttributesFromSchema', () => {
    it('should extract keys from schema shape', () => {
      const schema = z.object({
        variant: z.string(),
        size: z.string(),
        disabled: z.boolean(),
      });

      const attrs = getObservedAttributesFromSchema(schema);

      expect(attrs).toContain('variant');
      expect(attrs).toContain('size');
      expect(attrs).toContain('disabled');
    });

    it('should convert camelCase keys to kebab-case', () => {
      const schema = z.object({
        fullWidth: z.boolean(),
        iconBefore: z.string(),
      });

      const attrs = getObservedAttributesFromSchema(schema);

      expect(attrs).toContain('full-width');
      expect(attrs).toContain('icon-before');
    });

    it('should include common attributes', () => {
      const schema = z.object({});
      const attrs = getObservedAttributesFromSchema(schema);

      expect(attrs).toContain('class');
      expect(attrs).toContain('id');
      expect(attrs).toContain('style');
    });

    it('should deduplicate attributes', () => {
      const schema = z.object({
        class: z.string(),
        id: z.string(),
      });

      const attrs = getObservedAttributesFromSchema(schema);

      // Should not have duplicates
      const uniqueAttrs = [...new Set(attrs)];
      expect(attrs.length).toBe(uniqueAttrs.length);
    });
  });
});
