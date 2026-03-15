import 'reflect-metadata';
import { normalizeApp } from '../app.utils';
import { AppKind } from '../../common';
import { MissingProvideError } from '../../errors';

describe('normalizeApp', () => {
  it('should recognize npm remote app with package specifier (no URI scheme)', () => {
    const input = { name: '@test/esm-tools', urlType: 'npm', url: '@test/esm-tools@^1.0.0', standalone: false };
    const result = normalizeApp(input as any);

    expect(result.kind).toBe(AppKind.REMOTE_VALUE);
    expect(result.metadata).toMatchObject({ name: '@test/esm-tools', urlType: 'npm' });
  });

  it('should recognize esm remote app with package specifier', () => {
    const input = { name: '@test/esm-mod', urlType: 'esm', url: '@test/esm-mod@latest', standalone: false };
    const result = normalizeApp(input as any);

    expect(result.kind).toBe(AppKind.REMOTE_VALUE);
    expect(result.metadata).toMatchObject({ name: '@test/esm-mod', urlType: 'esm' });
  });

  it('should recognize url remote app with valid URI', () => {
    const input = { name: 'remote-server', urlType: 'url', url: 'https://api.example.com/mcp', standalone: false };
    const result = normalizeApp(input as any);

    expect(result.kind).toBe(AppKind.REMOTE_VALUE);
    expect(result.metadata).toMatchObject({ name: 'remote-server', urlType: 'url' });
  });

  it('should recognize worker remote app with valid URI', () => {
    const input = { name: 'worker-app', urlType: 'worker', url: 'file://./workers/app.js', standalone: false };
    const result = normalizeApp(input as any);

    expect(result.kind).toBe(AppKind.REMOTE_VALUE);
    expect(result.metadata).toMatchObject({ name: 'worker-app', urlType: 'worker' });
  });

  it('should throw MissingProvideError for object without provide', () => {
    const input = { name: 'bad-app', foo: 'bar' };
    expect(() => normalizeApp(input as any)).toThrow(MissingProvideError);
  });

  it('should use id over name for remote app symbol token', () => {
    const input = { id: 'custom-id', name: '@test/pkg', urlType: 'npm', url: '@test/pkg@^1.0.0', standalone: false };
    const result = normalizeApp(input as any);

    expect(result.kind).toBe(AppKind.REMOTE_VALUE);
    expect(result.provide.toString()).toContain('custom-id');
  });

  it('should reject url type with invalid URI', () => {
    const input = { name: 'bad-url', urlType: 'url', url: 'not-a-valid-uri', standalone: false };
    // Falls through isRemoteAppConfig since url has no scheme, hits the generic handler
    expect(() => normalizeApp(input as any)).toThrow();
  });
});
