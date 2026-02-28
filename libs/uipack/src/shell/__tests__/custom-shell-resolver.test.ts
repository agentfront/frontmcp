/**
 * Custom Shell Resolver Tests
 */

import { resolveShellTemplate, clearShellTemplateCache } from '../custom-shell-resolver';
import type { ResolveShellOptions } from '../custom-shell-resolver';
import type { ImportResolver } from '../../resolver/types';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  clearShellTemplateCache();
});

// ============================================
// Inline Resolution
// ============================================

describe('resolveShellTemplate - inline', () => {
  it('should resolve a valid inline template', async () => {
    const result = await resolveShellTemplate({
      inline: '<html><body>{{CONTENT}}</body></html>',
    });

    expect(result.sourceType).toBe('inline');
    expect(result.template).toBe('<html><body>{{CONTENT}}</body></html>');
    expect(result.validation.valid).toBe(true);
  });

  it('should throw for inline template missing CONTENT', async () => {
    await expect(resolveShellTemplate({ inline: '<html><body>No placeholder</body></html>' })).rejects.toThrow(
      'missing required placeholder(s): {{CONTENT}}',
    );
  });

  it('should not cache inline templates', async () => {
    const r1 = await resolveShellTemplate({ inline: '<html>{{CONTENT}}</html>' });
    const r2 = await resolveShellTemplate({ inline: '<html>{{CONTENT}}</html>' });

    // Both should succeed (inline is never cached, no fetch involved)
    expect(r1.template).toBe(r2.template);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================
// URL Resolution
// ============================================

describe('resolveShellTemplate - url', () => {
  it('should fetch and resolve a URL template', async () => {
    const html = '<!DOCTYPE html><html><body>{{CONTENT}}</body></html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await resolveShellTemplate({ url: 'https://example.com/shell.html' });

    expect(result.sourceType).toBe('url');
    expect(result.template).toBe(html);
    expect(result.validation.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should cache URL templates by default', async () => {
    const html = '<html>{{CONTENT}}</html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const r1 = await resolveShellTemplate({ url: 'https://example.com/shell.html' });
    const r2 = await resolveShellTemplate({ url: 'https://example.com/shell.html' });

    expect(r1).toBe(r2); // Same object from cache
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only fetched once
  });

  it('should skip cache when noCache is true', async () => {
    const html = '<html>{{CONTENT}}</html>';
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    });

    await resolveShellTemplate({ url: 'https://example.com/shell.html' }, { noCache: true });
    await resolveShellTemplate({ url: 'https://example.com/shell.html' }, { noCache: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(resolveShellTemplate({ url: 'https://example.com/missing.html' })).rejects.toThrow('HTTP 404');
  });

  it('should throw on fetch timeout', async () => {
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          // Simulate AbortController abort
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          setTimeout(() => reject(err), 10);
        }),
    );

    await expect(resolveShellTemplate({ url: 'https://example.com/slow.html', timeout: 5 })).rejects.toThrow(
      'timed out',
    );
  });

  it('should throw if URL template missing CONTENT', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<html><body>No placeholder</body></html>'),
    });

    await expect(resolveShellTemplate({ url: 'https://example.com/bad.html' })).rejects.toThrow(
      'missing required placeholder',
    );
  });

  it('should use custom timeout', async () => {
    const html = '<html>{{CONTENT}}</html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });

    const result = await resolveShellTemplate({ url: 'https://example.com/shell.html', timeout: 30000 });
    expect(result.validation.valid).toBe(true);
  });
});

// ============================================
// NPM Resolution
// ============================================

describe('resolveShellTemplate - npm', () => {
  it('should resolve npm package via default esm.sh fallback', async () => {
    const moduleText = 'export default `<html>{{CONTENT}}</html>`';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    const result = await resolveShellTemplate({ npm: 'my-shell-pkg' });

    expect(result.sourceType).toBe('npm');
    expect(result.template).toBe('<html>{{CONTENT}}</html>');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://esm.sh/my-shell-pkg',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should resolve npm package with version', async () => {
    const moduleText = 'export default `<html>{{CONTENT}}</html>`';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    const result = await resolveShellTemplate({ npm: 'my-shell-pkg', version: '2.0.0' });

    expect(result.sourceType).toBe('npm');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://esm.sh/my-shell-pkg@2.0.0',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should use custom resolver for npm packages', async () => {
    const moduleText = 'export default `<html>{{CONTENT}}</html>`';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    const resolver: ImportResolver = {
      resolve: jest.fn().mockReturnValue({
        value: 'https://cdn.custom.com/my-shell-pkg/index.js',
        type: 'url',
      }),
    };

    const result = await resolveShellTemplate({ npm: 'my-shell-pkg' }, { resolver });

    expect(result.sourceType).toBe('npm');
    expect(resolver.resolve).toHaveBeenCalledWith('my-shell-pkg');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cdn.custom.com/my-shell-pkg/index.js',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should extract named export from npm module', async () => {
    const moduleText = 'export const darkShell = `<html class="dark">{{CONTENT}}</html>`';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    const result = await resolveShellTemplate({
      npm: 'my-shell-pkg',
      exportName: 'darkShell',
    });

    expect(result.template).toBe('<html class="dark">{{CONTENT}}</html>');
  });

  it('should throw if named export not found', async () => {
    const moduleText = 'export default `<html>{{CONTENT}}</html>`';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    await expect(resolveShellTemplate({ npm: 'my-shell-pkg', exportName: 'missing' })).rejects.toThrow(
      'Could not extract named export "missing"',
    );
  });

  it('should throw if default export not found', async () => {
    const moduleText = 'export const something = 42;';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    await expect(resolveShellTemplate({ npm: 'my-shell-pkg' })).rejects.toThrow('Could not extract default export');
  });

  it('should cache npm templates by specifier', async () => {
    const moduleText = 'export default `<html>{{CONTENT}}</html>`';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(moduleText),
    });

    const r1 = await resolveShellTemplate({ npm: 'my-shell-pkg' });
    const r2 = await resolveShellTemplate({ npm: 'my-shell-pkg' });

    expect(r1).toBe(r2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should cache npm packages with version separately', async () => {
    const moduleText1 = 'export default `<html>v1 {{CONTENT}}</html>`';
    const moduleText2 = 'export default `<html>v2 {{CONTENT}}</html>`';
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(moduleText1) })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(moduleText2) });

    const r1 = await resolveShellTemplate({ npm: 'my-shell-pkg' });
    const r2 = await resolveShellTemplate({ npm: 'my-shell-pkg', version: '2.0.0' });

    expect(r1.template).toContain('v1');
    expect(r2.template).toContain('v2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ============================================
// Cache Clearing
// ============================================

describe('clearShellTemplateCache', () => {
  it('should force re-fetch after clearing cache', async () => {
    const html = '<html>{{CONTENT}}</html>';
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    });

    await resolveShellTemplate({ url: 'https://example.com/shell.html' });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    clearShellTemplateCache();

    await resolveShellTemplate({ url: 'https://example.com/shell.html' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ============================================
// Invalid Source
// ============================================

describe('resolveShellTemplate - invalid source', () => {
  it('should throw for invalid source object', async () => {
    await expect(resolveShellTemplate({} as never)).rejects.toThrow('Invalid custom shell source');
  });
});
