import {
  parseUriTemplate,
  matchUriTemplate,
  expandUriTemplate,
  extractTemplateParams,
  isUriTemplate,
} from '../uri-template.utils';

describe('URI Template Utils', () => {
  describe('parseUriTemplate', () => {
    it('should parse simple template with one param', () => {
      const result = parseUriTemplate('users/{userId}');

      expect(result.paramNames).toEqual(['userId']);
      expect(result.pattern.test('users/123')).toBe(true);
      expect(result.pattern.test('users/')).toBe(false);
    });

    it('should parse template with multiple params', () => {
      const result = parseUriTemplate('users/{userId}/posts/{postId}');

      expect(result.paramNames).toEqual(['userId', 'postId']);
      expect(result.pattern.test('users/123/posts/456')).toBe(true);
      expect(result.pattern.test('users/123/posts')).toBe(false);
    });

    it('should escape regex special characters', () => {
      const result = parseUriTemplate('file:///{path}');

      expect(result.paramNames).toEqual(['path']);
      expect(result.pattern.test('file:///documents')).toBe(true);
      expect(result.pattern.test('file://documents')).toBe(false);
    });

    it('should return empty paramNames for no-param template', () => {
      const result = parseUriTemplate('static://resource');

      expect(result.paramNames).toEqual([]);
      expect(result.pattern.test('static://resource')).toBe(true);
      expect(result.pattern.test('static://other')).toBe(false);
    });

    it('should handle template with special regex chars like dots', () => {
      const result = parseUriTemplate('api.example.com/{resource}');

      expect(result.paramNames).toEqual(['resource']);
      expect(result.pattern.test('api.example.com/users')).toBe(true);
      expect(result.pattern.test('apiXexampleXcom/users')).toBe(false);
    });

    it('should handle template with query-like pattern', () => {
      const result = parseUriTemplate('search?q={query}');

      expect(result.paramNames).toEqual(['query']);
      expect(result.pattern.test('search?q=hello')).toBe(true);
    });

    it('should handle template at the beginning', () => {
      const result = parseUriTemplate('{scheme}://example.com');

      expect(result.paramNames).toEqual(['scheme']);
      expect(result.pattern.test('https://example.com')).toBe(true);
    });
  });

  describe('matchUriTemplate', () => {
    it('should match URI and extract single param', () => {
      const params = matchUriTemplate('users/{userId}', 'users/123');

      expect(params).toEqual({ userId: '123' });
    });

    it('should match URI and extract multiple params', () => {
      const params = matchUriTemplate('users/{userId}/posts/{postId}', 'users/abc/posts/xyz');

      expect(params).toEqual({ userId: 'abc', postId: 'xyz' });
    });

    it('should return null for non-matching URI', () => {
      const params = matchUriTemplate('users/{userId}', 'posts/123');

      expect(params).toBeNull();
    });

    it('should decode URL-encoded param values', () => {
      const params = matchUriTemplate('files/{name}', 'files/hello%20world');

      expect(params).toEqual({ name: 'hello world' });
    });

    it('should not match slash in param value', () => {
      const params = matchUriTemplate('files/{name}', 'files/path/to/file');

      expect(params).toBeNull();
    });

    it('should match empty string if param allows it', () => {
      // The current implementation requires at least one char ([^/]+)
      const params = matchUriTemplate('prefix/{id}/suffix', 'prefix//suffix');

      expect(params).toBeNull();
    });

    it('should handle special characters in URI', () => {
      const params = matchUriTemplate('file:///{path}', 'file:///documents');

      expect(params).toEqual({ path: 'documents' });
    });

    it('should return empty object for static template that matches', () => {
      const params = matchUriTemplate('static://resource', 'static://resource');

      expect(params).toEqual({});
    });

    it('should handle params with numbers', () => {
      const params = matchUriTemplate('item/{id}', 'item/42');

      expect(params).toEqual({ id: '42' });
    });
  });

  describe('expandUriTemplate', () => {
    it('should expand template with params', () => {
      const result = expandUriTemplate('users/{userId}', { userId: '123' });

      expect(result).toBe('users/123');
    });

    it('should expand template with multiple params', () => {
      const result = expandUriTemplate('users/{userId}/posts/{postId}', {
        userId: 'abc',
        postId: 'xyz',
      });

      expect(result).toBe('users/abc/posts/xyz');
    });

    it('should URL-encode param values', () => {
      const result = expandUriTemplate('files/{name}', { name: 'hello world' });

      expect(result).toBe('files/hello%20world');
    });

    it('should URL-encode slashes in param values', () => {
      const result = expandUriTemplate('files/{path}', { path: 'path/to/file' });

      expect(result).toBe('files/path%2Fto%2Ffile');
    });

    it('should throw for missing required param', () => {
      expect(() => {
        expandUriTemplate('users/{userId}/posts/{postId}', { userId: '123' });
      }).toThrow("Missing parameter 'postId'");
    });

    it('should handle static template with no params', () => {
      const result = expandUriTemplate('static://resource', {});

      expect(result).toBe('static://resource');
    });

    it('should handle special characters in values', () => {
      const result = expandUriTemplate('search/{query}', { query: 'a+b=c&d' });

      expect(result).toBe('search/a%2Bb%3Dc%26d');
    });
  });

  describe('extractTemplateParams', () => {
    it('should extract param names from template', () => {
      const params = extractTemplateParams('users/{userId}/posts/{postId}');

      expect(params).toEqual(['userId', 'postId']);
    });

    it('should return empty array for no params', () => {
      const params = extractTemplateParams('static://resource');

      expect(params).toEqual([]);
    });

    it('should extract single param', () => {
      const params = extractTemplateParams('files/{name}');

      expect(params).toEqual(['name']);
    });

    it('should preserve param order', () => {
      const params = extractTemplateParams('{a}/{b}/{c}');

      expect(params).toEqual(['a', 'b', 'c']);
    });
  });

  describe('isUriTemplate', () => {
    it('should return true for template with {param}', () => {
      expect(isUriTemplate('users/{userId}')).toBe(true);
    });

    it('should return true for template with multiple params', () => {
      expect(isUriTemplate('users/{userId}/posts/{postId}')).toBe(true);
    });

    it('should return false for static URI', () => {
      expect(isUriTemplate('static://resource')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isUriTemplate('')).toBe(false);
    });

    it('should return false for malformed braces', () => {
      expect(isUriTemplate('users/{}')).toBe(false);
      expect(isUriTemplate('users/{')).toBe(false);
      expect(isUriTemplate('users/}')).toBe(false);
    });

    it('should return true for param at beginning', () => {
      expect(isUriTemplate('{scheme}://example.com')).toBe(true);
    });

    it('should return true for param at end', () => {
      expect(isUriTemplate('api/resource/{id}')).toBe(true);
    });
  });
});
