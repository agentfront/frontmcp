import {
  getFrontmcpVersion,
  getFrontmcpDependencies,
  getFrontmcpDevDependencies,
  getNxDependencies,
  getNxDevDependencies,
} from './versions';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(true),
}));

jest.mock('@nx/devkit', () => ({
  readJsonFile: jest.fn().mockReturnValue({ name: '@frontmcp/nx', version: '0.11.1' }),
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
      expect(deps['frontmcp']).toBe('~0.11.1');
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
      expect(deps['nx']).toBe('22.6.4');
      expect(deps['@nx/devkit']).toBe('22.6.4');
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
