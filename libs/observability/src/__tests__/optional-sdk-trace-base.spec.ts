/**
 * `@opentelemetry/sdk-trace-base` is an optional peer: the package loads without it, and only
 * `createTestTracer()` needs it.
 */
import 'reflect-metadata';

function withoutSdkTraceBase<T>(load: () => T): T {
  let loaded: T | undefined;
  jest.isolateModules(() => {
    jest.doMock('@opentelemetry/sdk-trace-base', () => {
      throw new Error("Cannot find module '@opentelemetry/sdk-trace-base'");
    });
    loaded = load();
  });
  return loaded as T;
}

describe('without @opentelemetry/sdk-trace-base', () => {
  afterEach(() => {
    jest.dontMock('@opentelemetry/sdk-trace-base');
  });

  it('loads the package', () => {
    const observability = withoutSdkTraceBase(() => require('../index') as typeof import('../index'));

    expect(typeof observability.createCounter).toBe('function');
  });

  it('fails only when createTestTracer() needs it', () => {
    const testing = withoutSdkTraceBase(() => require('../testing') as typeof import('../testing'));

    expect(() => testing.createTestTracer()).toThrow("Cannot find module '@opentelemetry/sdk-trace-base'");
  });
});
