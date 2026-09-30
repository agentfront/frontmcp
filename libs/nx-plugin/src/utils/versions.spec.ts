import {
  getFrontmcpDependencies,
  getFrontmcpDevDependencies,
  getFrontmcpVersion,
  getNxDependencies,
  getNxDevDependencies,
  getNxVersion,
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

  describe('getNxVersion', () => {
    it('should return the nx version string', () => {
      expect(getNxVersion()).toBe('22.6.4');
    });
  });

  describe('getNxDependencies', () => {
    it('should return nx core dependencies using NX_VERSION', () => {
      const deps = getNxDependencies();
      const version = getNxVersion();
      expect(deps['nx']).toBe(version);
      expect(deps['@nx/devkit']).toBe(version);
    });
  });

  describe('getNxDevDependencies', () => {
    it('should return nx dev dependencies', () => {
      const deps = getNxDevDependencies();
      expect(deps['typescript']).toBeDefined();
      expect(deps['jest']).toBeDefined();
    });

    it('pins swc to the range nx declares as its peer (create --nx ERESOLVE)', () => {
      const peers: Record<string, string> = jest.requireActual('nx/package.json').peerDependencies;
      const deps = getNxDevDependencies();
      const floor = (range: string) =>
        range
          .replace(/^[\^~]/, '')
          .split('.')
          .map(Number);
      const [pMajor, pMinor, pPatch] = floor(peers['@swc/core']);
      const [major, minor, patch] = floor(deps['@swc/core']);
      expect(major).toBe(pMajor);
      expect(minor).toBeGreaterThanOrEqual(pMinor);
      if (minor === pMinor) expect(patch).toBeGreaterThanOrEqual(pPatch);

      const [nMajor, nMinor] = floor(peers['@swc-node/register']);
      const [rMajor, rMinor] = floor(deps['@swc-node/register']);
      expect(rMajor).toBe(nMajor);
      expect(rMinor).toBeGreaterThanOrEqual(nMinor);
    });
  });
});
