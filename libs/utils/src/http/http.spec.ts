import { validateBaseUrl } from './http';

describe('HTTP Utils', () => {
  describe('validateBaseUrl', () => {
    it('should accept valid https URL', () => {
      const url = validateBaseUrl('https://api.example.com');
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('api.example.com');
    });

    it('should accept valid http URL', () => {
      const url = validateBaseUrl('http://localhost:3000');
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('localhost');
      expect(url.port).toBe('3000');
    });

    it('should accept URL with path', () => {
      const url = validateBaseUrl('https://api.example.com/v1');
      expect(url.pathname).toBe('/v1');
    });

    it('should throw for file:// protocol', () => {
      expect(() => validateBaseUrl('file:///etc/passwd')).toThrow('Unsupported protocol');
    });

    it('should throw for javascript: protocol', () => {
      expect(() => validateBaseUrl('javascript:alert(1)')).toThrow('Unsupported protocol');
    });

    it('should throw for data: protocol', () => {
      expect(() => validateBaseUrl('data:text/html,<script>alert(1)</script>')).toThrow('Unsupported protocol');
    });

    it('should throw for ftp: protocol', () => {
      expect(() => validateBaseUrl('ftp://files.example.com')).toThrow('Unsupported protocol');
    });

    it('should throw for invalid URL', () => {
      expect(() => validateBaseUrl('not a url')).toThrow('Invalid base URL');
    });

    it('should throw for empty string', () => {
      expect(() => validateBaseUrl('')).toThrow('Invalid base URL');
    });

    it('should throw for malformed URL', () => {
      expect(() => validateBaseUrl('http://')).toThrow('Invalid base URL');
    });
  });
});
