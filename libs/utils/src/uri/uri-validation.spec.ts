import { isValidMcpUri, extractUriScheme, isValidMcpUriTemplate } from './uri-validation';

describe('URI Validation Utils', () => {
  describe('isValidMcpUri', () => {
    it('should return true for file:// URIs', () => {
      expect(isValidMcpUri('file:///path/to/file')).toBe(true);
    });

    it('should return true for https:// URIs', () => {
      expect(isValidMcpUri('https://example.com/resource')).toBe(true);
    });

    it('should return true for http:// URIs', () => {
      expect(isValidMcpUri('http://localhost:3000')).toBe(true);
    });

    it('should return true for custom scheme URIs', () => {
      expect(isValidMcpUri('custom://my-resource')).toBe(true);
    });

    it('should return false for paths without scheme', () => {
      expect(isValidMcpUri('/path/to/file')).toBe(false);
    });

    it('should return false for schemes not starting with letter', () => {
      expect(isValidMcpUri('123://invalid')).toBe(false);
    });

    it('should return true for schemes with +, -, .', () => {
      expect(isValidMcpUri('my+scheme://resource')).toBe(true);
      expect(isValidMcpUri('my-scheme://resource')).toBe(true);
      expect(isValidMcpUri('my.scheme://resource')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(isValidMcpUri('')).toBe(false);
    });
  });

  describe('extractUriScheme', () => {
    it('should extract scheme from file URI', () => {
      expect(extractUriScheme('file:///path')).toBe('file');
    });

    it('should extract scheme from https URI', () => {
      expect(extractUriScheme('https://example.com')).toBe('https');
    });

    it('should return lowercase scheme', () => {
      expect(extractUriScheme('HTTPS://example.com')).toBe('https');
    });

    it('should return null for path without scheme', () => {
      expect(extractUriScheme('/no/scheme')).toBeNull();
    });

    it('should extract custom scheme', () => {
      expect(extractUriScheme('custom://resource')).toBe('custom');
    });

    it('should handle empty string', () => {
      expect(extractUriScheme('')).toBeNull();
    });
  });

  describe('isValidMcpUriTemplate', () => {
    it('should return true for templates with valid scheme', () => {
      expect(isValidMcpUriTemplate('users://{userId}/profile')).toBe(true);
    });

    it('should return true for file:// templates', () => {
      expect(isValidMcpUriTemplate('file:///{path}')).toBe(true);
    });

    it('should return false for templates with dynamic scheme', () => {
      expect(isValidMcpUriTemplate('{scheme}://dynamic')).toBe(false);
    });

    it('should return false for templates without scheme', () => {
      expect(isValidMcpUriTemplate('/path/{param}')).toBe(false);
    });
  });
});
