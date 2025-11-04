import {
  splitWords,
  toCase,
  normalizeSegment,
  normalizeProviderId,
  normalizeOwnerPath,
  shortHash,
  ensureMaxLen,
  sepFor,
  ownerKeyOf,
  qualifiedNameOf,
} from './tool.utils';
import { NameCase } from './tool.types';
import { EntryLineage } from '@frontmcp/sdk';

describe('tool.utils', () => {
  describe('splitWords', () => {
    it('should split camelCase words', () => {
      expect(splitWords('camelCase')).toEqual(['camel', 'Case']);
    });

    it('should split PascalCase words', () => {
      expect(splitWords('PascalCase')).toEqual(['Pascal', 'Case']);
    });

    it('should handle consecutive uppercase letters', () => {
      expect(splitWords('HTTPServer')).toEqual(['HTTPServer']);
    });

    it('should split on special characters', () => {
      expect(splitWords('snake_case')).toEqual(['snake', 'case']);
      expect(splitWords('kebab-case')).toEqual(['kebab', 'case']);
    });

    it('should handle mixed formats', () => {
      expect(splitWords('get_HTTPClient')).toEqual(['get', 'HTTPClient']);
    });

    it('should handle empty string', () => {
      expect(splitWords('')).toEqual([]);
    });

    it('should handle single word', () => {
      expect(splitWords('word')).toEqual(['word']);
    });

    it('should filter out non-alphanumeric separators', () => {
      expect(splitWords('word@#$another')).toEqual(['word', 'another']);
    });

    it('should handle numbers', () => {
      expect(splitWords('tool123Name')).toEqual(['tool123', 'Name']);
    });
  });

  describe('toCase', () => {
    const words = ['hello', 'world', 'test'];

    it('should convert to snake_case', () => {
      expect(toCase(words, 'snake')).toBe('hello_world_test');
    });

    it('should convert to kebab-case', () => {
      expect(toCase(words, 'kebab')).toBe('hello-world-test');
    });

    it('should convert to dot.case', () => {
      expect(toCase(words, 'dot')).toBe('hello.world.test');
    });

    it('should convert to camelCase', () => {
      expect(toCase(words, 'camel')).toBe('helloWorldTest');
    });

    it('should handle empty array', () => {
      expect(toCase([], 'snake')).toBe('');
      expect(toCase([], 'camel')).toBe('');
    });

    it('should handle single word', () => {
      expect(toCase(['hello'], 'camel')).toBe('hello');
      expect(toCase(['HELLO'], 'camel')).toBe('hello');
    });

    it('should filter out empty strings', () => {
      expect(toCase(['', 'hello', '', 'world'], 'snake')).toBe('hello_world');
    });

    it('should handle mixed case words', () => {
      expect(toCase(['HeLLo', 'WoRLd'], 'snake')).toBe('hello_world');
    });
  });

  describe('normalizeSegment', () => {
    it('should normalize simple names to snake_case', () => {
      expect(normalizeSegment('HelloWorld', 'snake')).toBe('hello_world');
    });

    it('should normalize simple names to kebab-case', () => {
      expect(normalizeSegment('HelloWorld', 'kebab')).toBe('hello-world');
    });

    it('should normalize simple names to dot.case', () => {
      expect(normalizeSegment('HelloWorld', 'dot')).toBe('hello.world');
    });

    it('should normalize simple names to camelCase', () => {
      expect(normalizeSegment('HelloWorld', 'camel')).toBe('helloWorld');
    });

    it('should filter invalid MCP characters', () => {
      expect(normalizeSegment('hello@world!', 'snake')).toBe('helloworld');
    });

    it('should handle empty string by returning x', () => {
      expect(normalizeSegment('', 'snake')).toBe('x');
      expect(normalizeSegment('@#$', 'snake')).toBe('x');
    });

    it('should preserve valid MCP characters (alphanumeric, _, -, ., /)', () => {
      expect(normalizeSegment('valid_name-123', 'snake')).toBe('valid_name_123');
    });

    it('should handle special characters mixed with alphanumeric', () => {
      expect(normalizeSegment('hello$%world', 'kebab')).toBe('hello-world');
    });
  });

  describe('normalizeProviderId', () => {
    it('should return undefined for undefined input', () => {
      expect(normalizeProviderId(undefined, 'snake')).toBeUndefined();
    });

    it('should normalize provider IDs to snake_case', () => {
      expect(normalizeProviderId('MyProvider', 'snake')).toBe('my_provider');
    });

    it('should normalize provider IDs to kebab-case', () => {
      expect(normalizeProviderId('MyProvider', 'kebab')).toBe('my-provider');
    });

    it('should handle special characters', () => {
      expect(normalizeProviderId('my@provider!test', 'snake')).toBe('my_provider_test');
    });

    it('should return undefined for empty string after filtering', () => {
      expect(normalizeProviderId('@#$', 'snake')).toBeUndefined();
    });

    it('should handle dot notation', () => {
      expect(normalizeProviderId('com.example.provider', 'dot')).toBe('com.example.provider');
    });
  });

  describe('normalizeOwnerPath', () => {
    it('should normalize simple owner path to snake_case', () => {
      expect(normalizeOwnerPath('app:Portal', 'snake')).toBe('app_portal');
    });

    it('should normalize complex owner path to snake_case', () => {
      expect(normalizeOwnerPath('app:Portal/plugin:Auth', 'snake')).toBe('app_portal_plugin_auth');
    });

    it('should normalize to kebab-case', () => {
      expect(normalizeOwnerPath('app:Portal/plugin:Auth', 'kebab')).toBe('app-portal-plugin-auth');
    });

    it('should normalize to dot.case', () => {
      expect(normalizeOwnerPath('app:Portal/plugin:Auth', 'dot')).toBe('app.portal.plugin.auth');
    });

    it('should normalize to camelCase', () => {
      expect(normalizeOwnerPath('app:Portal/plugin:Auth', 'camel')).toBe('appPortalpluginAuth');
    });

    it('should handle multi-level paths', () => {
      expect(normalizeOwnerPath('app:MyApp/adapter:OpenAPI/tool:GetUser', 'snake')).toBe(
        'app_myapp_adapter_openapi_tool_getuser'
      );
    });

    it('should handle empty segments gracefully', () => {
      expect(normalizeOwnerPath('app:/plugin:Test', 'snake')).toBe('app_x_plugin_test');
    });
  });

  describe('shortHash', () => {
    it('should return a 6-character hex hash', () => {
      const hash = shortHash('test');
      expect(hash).toHaveLength(6);
      expect(hash).toMatch(/^[0-9a-f]{6}$/);
    });

    it('should return consistent hashes for same input', () => {
      const hash1 = shortHash('test');
      const hash2 = shortHash('test');
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = shortHash('test1');
      const hash2 = shortHash('test2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = shortHash('');
      expect(hash).toHaveLength(6);
      expect(hash).toMatch(/^[0-9a-f]{6}$/);
    });

    it('should handle long strings', () => {
      const longString = 'a'.repeat(1000);
      const hash = shortHash(longString);
      expect(hash).toHaveLength(6);
      expect(hash).toMatch(/^[0-9a-f]{6}$/);
    });

    it('should handle special characters', () => {
      const hash = shortHash('!@#$%^&*()');
      expect(hash).toHaveLength(6);
      expect(hash).toMatch(/^[0-9a-f]{6}$/);
    });
  });

  describe('ensureMaxLen', () => {
    it('should return name unchanged if within max length', () => {
      const name = 'shortName';
      expect(ensureMaxLen(name, 20)).toBe(name);
    });

    it('should truncate and add hash if name exceeds max length', () => {
      const name = 'veryLongNameThatExceedsTheMaximumLength';
      const result = ensureMaxLen(name, 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('-');
    });

    it('should preserve tail after separator', () => {
      const name = 'prefix_with_separator_tail';
      const result = ensureMaxLen(name, 20);
      expect(result).toContain('tail');
    });

    it('should handle name with multiple separators', () => {
      const name = 'app-portal-auth-tool-getUser';
      const result = ensureMaxLen(name, 20);
      expect(result.length).toBeLessThanOrEqual(20);
    });

    it('should include hash for uniqueness', () => {
      const name1 = 'veryLongName1ThatExceedsMaxLength';
      const name2 = 'veryLongName2ThatExceedsMaxLength';
      const result1 = ensureMaxLen(name1, 20);
      const result2 = ensureMaxLen(name2, 20);
      expect(result1).not.toBe(result2);
    });

    it('should handle very short max length', () => {
      const name = 'longName';
      const result = ensureMaxLen(name, 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('should handle edge case of max length equal to name length', () => {
      const name = 'exactLength';
      expect(ensureMaxLen(name, name.length)).toBe(name);
    });

    it('should handle names with dots', () => {
      const name = 'com.example.very.long.package.name';
      const result = ensureMaxLen(name, 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('name');
    });

    it('should handle names with slashes', () => {
      const name = 'app/plugin/adapter/tool/veryLongName';
      const result = ensureMaxLen(name, 20);
      expect(result.length).toBeLessThanOrEqual(20);
    });
  });

  describe('sepFor', () => {
    it('should return underscore for snake case', () => {
      expect(sepFor('snake')).toBe('_');
    });

    it('should return dash for kebab case', () => {
      expect(sepFor('kebab')).toBe('-');
    });

    it('should return dot for dot case', () => {
      expect(sepFor('dot')).toBe('.');
    });

    it('should return empty string for camel case', () => {
      expect(sepFor('camel')).toBe('');
    });
  });

  describe('ownerKeyOf', () => {
    it('should format single-level lineage', () => {
      const lineage: EntryLineage = [{ kind: 'app', id: 'portal', ref: {} as any }];
      expect(ownerKeyOf(lineage)).toBe('app:portal');
    });

    it('should format multi-level lineage with separator', () => {
      const lineage: EntryLineage = [
        { kind: 'app', id: 'portal', ref: {} as any },
        { kind: 'plugin', id: 'auth', ref: {} as any },
      ];
      expect(ownerKeyOf(lineage)).toBe('app:portal/plugin:auth');
    });

    it('should handle three-level lineage', () => {
      const lineage: EntryLineage = [
        { kind: 'app', id: 'portal', ref: {} as any },
        { kind: 'adapter', id: 'openapi', ref: {} as any },
        { kind: 'tool', id: 'getUser', ref: {} as any },
      ];
      expect(ownerKeyOf(lineage)).toBe('app:portal/adapter:openapi/tool:getUser');
    });

    it('should handle empty lineage', () => {
      expect(ownerKeyOf([])).toBe('');
    });
  });

  describe('qualifiedNameOf', () => {
    it('should combine owner key and name', () => {
      const lineage: EntryLineage = [{ kind: 'app', id: 'portal', ref: {} as any }];
      expect(qualifiedNameOf(lineage, 'myTool')).toBe('app:portal:myTool');
    });

    it('should handle multi-level lineage', () => {
      const lineage: EntryLineage = [
        { kind: 'app', id: 'portal', ref: {} as any },
        { kind: 'plugin', id: 'auth', ref: {} as any },
      ];
      expect(qualifiedNameOf(lineage, 'verifyToken')).toBe('app:portal/plugin:auth:verifyToken');
    });

    it('should handle empty lineage', () => {
      expect(qualifiedNameOf([], 'tool')).toBe(':tool');
    });

    it('should handle special characters in name', () => {
      const lineage: EntryLineage = [{ kind: 'app', id: 'portal', ref: {} as any }];
      expect(qualifiedNameOf(lineage, 'get-user')).toBe('app:portal:get-user');
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle round-trip through normalize and format', () => {
      const ownerPath = 'app:MyPortal/plugin:OAuth2';
      const normalized = normalizeOwnerPath(ownerPath, 'snake');
      expect(normalized).toBe('app_myportal_plugin_oauth2');
    });

    it('should ensure consistent hashing for truncated names', () => {
      const longName = 'a'.repeat(100);
      const result1 = ensureMaxLen(longName, 30);
      const result2 = ensureMaxLen(longName, 30);
      expect(result1).toBe(result2);
    });

    it('should handle case conversions preserving MCP compliance', () => {
      const name = 'get_User_Info';
      expect(normalizeSegment(name, 'camel')).toBe('getUserInfo');
      expect(normalizeSegment(name, 'kebab')).toBe('get-user-info');
      expect(normalizeSegment(name, 'dot')).toBe('get.user.info');
    });

    it('should handle complex real-world tool names', () => {
      const toolName = 'app:PortalApp/adapter:RestAPI/tool:getUserProfileById';
      const lineage: EntryLineage = [
        { kind: 'app', id: 'PortalApp', ref: {} as any },
        { kind: 'adapter', id: 'RestAPI', ref: {} as any },
      ];
      const ownerKey = ownerKeyOf(lineage);
      const qualified = qualifiedNameOf(lineage, 'getUserProfileById');
      expect(qualified).toContain(ownerKey);
      expect(qualified).toContain('getUserProfileById');
    });
  });
});