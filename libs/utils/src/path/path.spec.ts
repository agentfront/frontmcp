import { trimSlashes, joinPath } from './path';

describe('Path Utils', () => {
  describe('trimSlashes', () => {
    it('should trim leading slashes', () => {
      expect(trimSlashes('/path')).toBe('path');
    });

    it('should trim trailing slashes', () => {
      expect(trimSlashes('path/')).toBe('path');
    });

    it('should trim both leading and trailing slashes', () => {
      expect(trimSlashes('/path/to/resource/')).toBe('path/to/resource');
    });

    it('should trim multiple slashes', () => {
      expect(trimSlashes('///multiple///')).toBe('multiple');
    });

    it('should handle path with no slashes', () => {
      expect(trimSlashes('no-slashes')).toBe('no-slashes');
    });

    it('should handle empty string', () => {
      expect(trimSlashes('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(trimSlashes(null as any)).toBe('');
      expect(trimSlashes(undefined as any)).toBe('');
    });

    it('should handle only slashes', () => {
      expect(trimSlashes('///')).toBe('');
    });
  });

  describe('joinPath', () => {
    it('should join multiple segments', () => {
      expect(joinPath('api', 'v1', 'users')).toBe('/api/v1/users');
    });

    it('should handle segments with slashes', () => {
      expect(joinPath('/api/', '/v1/', '/users/')).toBe('/api/v1/users');
    });

    it('should filter empty segments', () => {
      expect(joinPath('', 'path', '')).toBe('/path');
    });

    it('should return empty string for no segments', () => {
      expect(joinPath()).toBe('');
    });

    it('should return empty string for all empty segments', () => {
      expect(joinPath('', '', '')).toBe('');
    });

    it('should handle single segment', () => {
      expect(joinPath('segment')).toBe('/segment');
    });

    it('should preserve internal slashes in segments', () => {
      // Note: trimSlashes on each part means internal structure is preserved
      expect(joinPath('a/b', 'c/d')).toBe('/a/b/c/d');
    });
  });
});
