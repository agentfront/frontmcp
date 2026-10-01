/**
 * A renamed bypass header (#678).
 *
 * The plugin reads the bypass header from the request context, which keeps only the request's
 * `x-frontmcp-*` headers. The docs showed `bypassHeader: 'x-no-cache'`, a header that never reaches
 * the plugin: the server started and the header was silently ignored. A name without the prefix is
 * now refused when the plugin is configured.
 */
import 'reflect-metadata';

import { FrontMcpContextStorage } from '@frontmcp/sdk';

import { CachePluginConfigurationError } from '../cache.errors';
import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

/** Whether the plugin bypasses the cache for a request that sent these `x-frontmcp-*` headers. */
function bypasses(plugin: CachePlugin, customHeaders: Record<string, string>): boolean {
  const contextStorage = { getStore: () => ({ metadata: { customHeaders } }) };
  Object.assign(plugin, {
    get: (token: unknown) => (token === FrontMcpContextStorage ? contextStorage : undefined),
  });
  return (plugin as unknown as { shouldBypassCache: (flowCtx: unknown) => boolean }).shouldBypassCache({});
}

describe('CachePlugin — bypassHeader (#678)', () => {
  describe('configuration', () => {
    it.each(['x-no-cache', 'cache-control', 'X-Disable-Cache', ''])('refuses %j, which never reaches the plugin', (name) => {
      expect(() => CachePlugin.init({ type: 'memory', bypassHeader: name })).toThrow(CachePluginConfigurationError);
    });

    it('names the header and the required prefix', () => {
      expect(() => new CachePlugin({ type: 'memory', bypassHeader: 'x-no-cache' })).toThrow(
        /bypassHeader "x-no-cache".*x-frontmcp-/,
      );
    });

    it.each(['x-frontmcp-no-cache', 'X-FrontMCP-Skip-Cache'])('accepts %j', (name) => {
      expect(() => CachePlugin.init({ type: 'memory', bypassHeader: name })).not.toThrow();
    });

    it('accepts no bypassHeader, which keeps the default header', () => {
      expect(() => CachePlugin.init({ type: 'memory' })).not.toThrow();
    });
  });

  describe('a renamed header on a request', () => {
    // The request context stores x-frontmcp-* header names lowercased, whatever the client sent.
    it('bypasses the cache when the renamed header is sent, matched case-insensitively', () => {
      const plugin = new CachePlugin({ type: 'memory', bypassHeader: 'X-FrontMCP-No-Cache' });

      expect(bypasses(plugin, { 'x-frontmcp-no-cache': 'true' })).toBe(true);
      expect(bypasses(plugin, { 'x-frontmcp-no-cache': '1' })).toBe(true);
    });

    it('ignores the default header once the header is renamed', () => {
      const plugin = new CachePlugin({ type: 'memory', bypassHeader: 'x-frontmcp-no-cache' });

      expect(bypasses(plugin, { 'x-frontmcp-disable-cache': 'true' })).toBe(false);
    });
  });
});
