/**
 * Common Utilities Tests
 */

import { createLazyImport } from '../common/lazy-import';
import { injectStylesheet } from '../common/inject-stylesheet';

// ============================================
// createLazyImport Tests
// ============================================

describe('createLazyImport', () => {
  it('should start in idle state', () => {
    const lazy = createLazyImport<string>('test-module', async () => 'loaded');
    expect(lazy.getState().status).toBe('idle');
    expect(lazy.get()).toBeUndefined();
  });

  it('should load module and transition to loaded state', async () => {
    const lazy = createLazyImport<string>('test-module', async () => 'loaded-value');
    const result = await lazy.load();
    expect(result).toBe('loaded-value');
    expect(lazy.getState().status).toBe('loaded');
    expect(lazy.get()).toBe('loaded-value');
  });

  it('should return cached module on subsequent loads', async () => {
    let callCount = 0;
    const lazy = createLazyImport<string>('test-module', async () => {
      callCount++;
      return 'loaded';
    });

    await lazy.load();
    await lazy.load();
    await lazy.load();

    expect(callCount).toBe(1);
    expect(lazy.get()).toBe('loaded');
  });

  it('should handle concurrent load calls', async () => {
    let callCount = 0;
    const lazy = createLazyImport<string>('test-module', async () => {
      callCount++;
      return 'loaded';
    });

    const [r1, r2, r3] = await Promise.all([lazy.load(), lazy.load(), lazy.load()]);

    expect(callCount).toBe(1);
    expect(r1).toBe('loaded');
    expect(r2).toBe('loaded');
    expect(r3).toBe('loaded');
  });

  it('should transition to error state on failure', async () => {
    const lazy = createLazyImport<string>('bad-module', async () => {
      throw new Error('import failed');
    });

    await expect(lazy.load()).rejects.toThrow('import failed');
    expect(lazy.getState().status).toBe('error');
    expect(lazy.get()).toBeUndefined();
  });

  it('should reject on subsequent calls after error', async () => {
    const lazy = createLazyImport<string>('bad-module', async () => {
      throw new Error('import failed');
    });

    await expect(lazy.load()).rejects.toThrow();
    await expect(lazy.load()).rejects.toThrow();
  });

  it('should wrap non-Error throws', async () => {
    const lazy = createLazyImport<string>('bad-module', async () => {
      throw 'string error';
    });

    await expect(lazy.load()).rejects.toThrow('Failed to load module "bad-module"');
  });

  it('should reset to idle state', async () => {
    const lazy = createLazyImport<string>('test-module', async () => 'loaded');
    await lazy.load();
    expect(lazy.getState().status).toBe('loaded');

    lazy.reset();
    expect(lazy.getState().status).toBe('idle');
    expect(lazy.get()).toBeUndefined();
  });

  it('should allow reload after reset', async () => {
    let value = 'first';
    const lazy = createLazyImport<string>('test-module', async () => value);

    await lazy.load();
    expect(lazy.get()).toBe('first');

    lazy.reset();
    value = 'second';
    await lazy.load();
    expect(lazy.get()).toBe('second');
  });
});

// ============================================
// injectStylesheet Tests
// ============================================

describe('injectStylesheet', () => {
  it('should not throw in non-browser environment', () => {
    // In node test environment, document is undefined by default
    const origDoc = (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).document;

    expect(() => injectStylesheet('https://example.com/styles.css', 'test-css')).not.toThrow();

    (globalThis as Record<string, unknown>).document = origDoc;
  });
});
