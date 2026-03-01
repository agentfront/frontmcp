import { parseInstallSource } from '../types';

describe('install types', () => {
  describe('parseInstallSource', () => {
    it('should detect local path starting with ./', () => {
      const result = parseInstallSource('./my-app');
      expect(result.type).toBe('local');
      expect(result.ref).toBe('./my-app');
    });

    it('should detect local path starting with ../', () => {
      const result = parseInstallSource('../my-app');
      expect(result.type).toBe('local');
      expect(result.ref).toBe('../my-app');
    });

    it('should detect local absolute path', () => {
      const result = parseInstallSource('/home/user/my-app');
      expect(result.type).toBe('local');
      expect(result.ref).toBe('/home/user/my-app');
    });

    it('should detect github: prefix as git', () => {
      const result = parseInstallSource('github:user/repo');
      expect(result.type).toBe('git');
      expect(result.ref).toBe('github:user/repo');
    });

    it('should detect git+ prefix as git', () => {
      const result = parseInstallSource('git+https://github.com/user/repo.git');
      expect(result.type).toBe('git');
    });

    it('should detect .git suffix as git', () => {
      const result = parseInstallSource('https://github.com/user/repo.git');
      expect(result.type).toBe('git');
    });

    it('should default to npm for package names', () => {
      const result = parseInstallSource('@company/my-mcp');
      expect(result.type).toBe('npm');
      expect(result.ref).toBe('@company/my-mcp');
    });

    it('should default to npm for unscoped packages', () => {
      const result = parseInstallSource('my-mcp-server');
      expect(result.type).toBe('npm');
      expect(result.ref).toBe('my-mcp-server');
    });
  });
});
