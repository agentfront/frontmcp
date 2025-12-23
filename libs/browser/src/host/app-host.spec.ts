// file: libs/browser/src/host/app-host.spec.ts
/**
 * @jest-environment jsdom
 */

import { createAppHost } from './app-host';
import { AppLoadError, AppTimeoutError, OriginNotAllowedError, type AppHost, type LoadedApp } from './types';

describe('createAppHost', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'app-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('factory function', () => {
    it('should create an AppHost instance', () => {
      const host = createAppHost({ container });

      expect(host).toBeDefined();
      expect(typeof host.load).toBe('function');
      expect(typeof host.unload).toBe('function');
      expect(typeof host.unloadAll).toBe('function');
      expect(typeof host.get).toBe('function');
      expect(typeof host.list).toBe('function');
      expect(typeof host.on).toBe('function');
      expect(typeof host.updateAuthContext).toBe('function');
      expect(typeof host.destroy).toBe('function');
    });

    it('should accept all configuration options', () => {
      const host = createAppHost({
        container,
        sandbox: ['allow-scripts', 'allow-forms'],
        allowedOrigins: ['https://example.com'],
        connectionTimeout: 10000,
        style: { border: 'none' },
        authContext: {
          token: 'test-token',
          userId: 'user-123',
        },
        onError: (error) => console.error(error),
      });

      expect(host).toBeDefined();
    });
  });

  describe('list()', () => {
    it('should return empty array initially', () => {
      const host = createAppHost({ container });
      expect(host.list()).toEqual([]);
    });
  });

  describe('get()', () => {
    it('should return undefined for non-existent app', () => {
      const host = createAppHost({ container });
      expect(host.get('non-existent')).toBeUndefined();
    });
  });

  describe('on()', () => {
    it('should register event handlers', () => {
      const host = createAppHost({ container });
      const handler = jest.fn();

      const unsubscribe = host.on('app:loaded', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should allow unsubscribing event handlers', () => {
      const host = createAppHost({ container });
      const handler = jest.fn();

      const unsubscribe = host.on('app:loaded', handler);
      unsubscribe();

      // Handler should be removed (no way to verify directly without loading an app)
    });
  });

  describe('updateAuthContext()', () => {
    it('should update auth context', () => {
      const host = createAppHost({
        container,
        authContext: { token: 'initial' },
      });

      // Should not throw
      host.updateAuthContext({ token: 'updated' });
    });
  });

  describe('load()', () => {
    it('should reject invalid URLs', async () => {
      const host = createAppHost({
        container,
        allowedOrigins: ['https://allowed.com'],
      });

      await expect(host.load({ src: 'not-a-valid-url' })).rejects.toThrow(AppLoadError);
    });

    it('should reject disallowed origins when allowedOrigins is set', async () => {
      const host = createAppHost({
        container,
        allowedOrigins: ['https://allowed.com'],
      });

      await expect(host.load({ src: 'https://not-allowed.com/app' })).rejects.toThrow(OriginNotAllowedError);
    });

    it('should allow any origin when allowedOrigins is empty', async () => {
      const host = createAppHost({
        container,
        connectionTimeout: 100, // Short timeout for test
      });

      // Will fail due to iframe not loading, but won't fail origin check
      await expect(host.load({ src: 'https://any-origin.com/app' })).rejects.toThrow();
    });
  });

  describe('unloadAll()', () => {
    it('should not throw when no apps are loaded', async () => {
      const host = createAppHost({ container });
      await expect(host.unloadAll()).resolves.toBeUndefined();
    });
  });

  describe('destroy()', () => {
    it('should clean up all resources', async () => {
      const host = createAppHost({ container });
      await expect(host.destroy()).resolves.toBeUndefined();
      expect(host.list()).toEqual([]);
    });
  });
});

describe('OriginNotAllowedError', () => {
  it('should include origin in message', () => {
    const error = new OriginNotAllowedError('https://bad.com');

    expect(error.message).toContain('https://bad.com');
    expect(error.origin).toBe('https://bad.com');
    expect(error.name).toBe('OriginNotAllowedError');
  });
});

describe('AppLoadError', () => {
  it('should include src in error', () => {
    const error = new AppLoadError('Load failed', 'https://app.com/index.html');

    expect(error.message).toBe('Load failed');
    expect(error.src).toBe('https://app.com/index.html');
    expect(error.name).toBe('AppLoadError');
  });
});

describe('AppTimeoutError', () => {
  it('should include appId in error', () => {
    const error = new AppTimeoutError('Request timed out', 'app-123');

    expect(error.message).toBe('Request timed out');
    expect(error.appId).toBe('app-123');
    expect(error.name).toBe('AppTimeoutError');
  });
});
