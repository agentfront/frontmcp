import {
  getFrontmcpVersion,
  getFrontmcpDependencies,
  getFrontmcpDevDependencies,
  getNxDependencies,
  getNxDevDependencies,
} from './versions';

jest.mock('@nx/devkit', () => ({
  readJsonFile: jest.fn().mockReturnValue({ version: '0.11.1' }),
}));

describe('versions', () => {
  describe('getFrontmcpVersion', () => {
    it('should return the plugin version', () => {
      expect(getFrontmcpVersion()).toBe('0.11.1');
    });
  });

  describe('getFrontmcpDependencies', () => {
    it('should return frontmcp dependencies with version range', () => {
      const deps = getFrontmcpDependencies();
      expect(deps['@frontmcp/sdk']).toBe('~0.11.1');
      expect(deps['@frontmcp/cli']).toBe('~0.11.1');
      expect(deps['reflect-metadata']).toBe('^0.2.2');
      expect(deps['zod']).toBe('^4.0.0');
    });
  });

  describe('getFrontmcpDevDependencies', () => {
    it('should return frontmcp dev dependencies', () => {
      const deps = getFrontmcpDevDependencies();
      expect(deps['@frontmcp/testing']).toBe('~0.11.1');
    });
  });

  describe('getNxDependencies', () => {
    it('should return nx core dependencies', () => {
      const deps = getNxDependencies();
      expect(deps['nx']).toBe('22.3.3');
      expect(deps['@nx/devkit']).toBe('22.3.3');
    });
  });

  describe('getNxDevDependencies', () => {
    it('should return nx dev dependencies', () => {
      const deps = getNxDevDependencies();
      expect(deps['typescript']).toBeDefined();
      expect(deps['jest']).toBeDefined();
    });
  });
});
