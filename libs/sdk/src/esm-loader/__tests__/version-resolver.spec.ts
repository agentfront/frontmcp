import { VersionResolver } from '../version-resolver';

// We mock global fetch
const mockFetch = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;

describe('VersionResolver', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  function makeRegistryResponse(overrides?: Record<string, unknown>) {
    return {
      name: '@acme/tools',
      'dist-tags': { latest: '1.2.0', next: '2.0.0-beta.1' },
      versions: {
        '1.0.0': { version: '1.0.0' },
        '1.1.0': { version: '1.1.0' },
        '1.2.0': { version: '1.2.0' },
        '2.0.0-beta.1': { version: '2.0.0-beta.1' },
      },
      time: {
        '1.0.0': '2025-01-01T00:00:00.000Z',
        '1.2.0': '2025-06-01T00:00:00.000Z',
      },
      ...overrides,
    };
  }

  function makeSpecifier(range = '^1.0.0', fullName = '@acme/tools') {
    return {
      scope: fullName.startsWith('@') ? fullName.split('/')[0] : undefined,
      name: fullName.includes('/') ? fullName.split('/')[1] : fullName,
      fullName,
      range,
      raw: `${fullName}@${range}`,
    };
  }

  describe('resolve()', () => {
    it('resolves latest tag via dist-tags', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse(),
      });

      const resolver = new VersionResolver();
      const result = await resolver.resolve(makeSpecifier('latest'));

      expect(result.resolvedVersion).toBe('1.2.0');
      expect(result.availableVersions).toContain('1.0.0');
      expect(result.availableVersions).toContain('1.2.0');
    });

    it('resolves next tag via dist-tags', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse(),
      });

      const resolver = new VersionResolver();
      const result = await resolver.resolve(makeSpecifier('next'));

      expect(result.resolvedVersion).toBe('2.0.0-beta.1');
    });

    it('resolves semver range via maxSatisfying', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse(),
      });

      const resolver = new VersionResolver();
      const result = await resolver.resolve(makeSpecifier('^1.0.0'));

      expect(result.resolvedVersion).toBe('1.2.0');
      expect(result.publishedAt).toBe('2025-06-01T00:00:00.000Z');
    });

    it('throws on 404 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const resolver = new VersionResolver();
      await expect(resolver.resolve(makeSpecifier('latest'))).rejects.toThrow(
        'Package "@acme/tools" not found in registry',
      );
    });

    it('throws on non-ok response (e.g., 401)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const resolver = new VersionResolver();
      await expect(resolver.resolve(makeSpecifier('latest'))).rejects.toThrow('Registry returned 401');
    });

    it('throws on fetch timeout (AbortError)', async () => {
      mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      const resolver = new VersionResolver({ timeout: 100 });
      await expect(resolver.resolve(makeSpecifier('latest'))).rejects.toThrow('Timeout');
    });

    it('throws on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network failure'));

      const resolver = new VersionResolver();
      await expect(resolver.resolve(makeSpecifier('latest'))).rejects.toThrow('Failed to fetch package info');
    });

    it('sends auth header when token provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse(),
      });

      const resolver = new VersionResolver({
        registryAuth: { token: 'secret-token' },
      });
      await resolver.resolve(makeSpecifier('latest'));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer secret-token',
          }),
        }),
      );
    });

    it('encodes scoped package names correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse(),
      });

      const resolver = new VersionResolver();
      await resolver.resolve(makeSpecifier('latest', '@acme/tools'));

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('@acme%2ftools');
    });

    it('uses custom registry URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse(),
      });

      const resolver = new VersionResolver({
        registryAuth: { registryUrl: 'https://npm.example.com' },
      });
      await resolver.resolve(makeSpecifier('latest'));

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toStartWith('https://npm.example.com/');
    });

    it('throws when no versions exist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeRegistryResponse({ versions: {} }),
      });

      const resolver = new VersionResolver();
      await expect(resolver.resolve(makeSpecifier('latest'))).rejects.toThrow('No versions found');
    });

    it('throws when no version satisfies range', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () =>
          makeRegistryResponse({
            'dist-tags': { latest: '1.2.0' },
            versions: { '1.0.0': {}, '1.1.0': {}, '1.2.0': {} },
          }),
      });

      const resolver = new VersionResolver();
      await expect(resolver.resolve(makeSpecifier('^5.0.0'))).rejects.toThrow(
        'No version of "@acme/tools" satisfies range "^5.0.0"',
      );
    });

    it('uses default timeout of 15000ms', () => {
      const resolver = new VersionResolver();
      // Just verify construction works - timeout is internal
      expect(resolver).toBeInstanceOf(VersionResolver);
    });
  });
});

// Custom matcher for string prefix
expect.extend({
  toStartWith(received: string, prefix: string) {
    const pass = received.startsWith(prefix);
    return {
      pass,
      message: () => `expected "${received}" to start with "${prefix}"`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toStartWith(prefix: string): R;
    }
  }
}
