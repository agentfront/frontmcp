import { isEdgeRuntime as isEdgeRuntimeInBrowserBuild } from '../browser-env';
import { isEdgeRuntime as isEdgeRuntimeInNodeBuild } from '../node-env';

const WORKER_GLOBAL_KEYS = [
  'caches',
  'self',
  'WorkerGlobalScope',
  'DedicatedWorkerGlobalScope',
  'importScripts',
  'navigator',
];
const EDGE_ENV_KEYS = ['EDGE_RUNTIME', 'VERCEL_ENV'];
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

class WorkerGlobalScope {
  static [Symbol.hasInstance](candidate: unknown): boolean {
    return candidate === globalThis;
  }
}

class DedicatedWorkerGlobalScope extends WorkerGlobalScope {}

function defineGlobal(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
}

function installBrowserDedicatedWorkerScope(): () => void {
  const savedGlobals = WORKER_GLOBAL_KEYS.map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
  }));
  const savedEnv = EDGE_ENV_KEYS.map((key) => ({ key, value: process.env[key] }));
  EDGE_ENV_KEYS.forEach((key) => delete process.env[key]);

  defineGlobal('caches', { open: async () => undefined, match: async () => undefined });
  defineGlobal('self', globalThis);
  defineGlobal('WorkerGlobalScope', WorkerGlobalScope);
  defineGlobal('DedicatedWorkerGlobalScope', DedicatedWorkerGlobalScope);
  defineGlobal('importScripts', () => undefined);
  defineGlobal('navigator', { userAgent: BROWSER_USER_AGENT });

  return () => {
    savedGlobals.forEach(({ key, descriptor }) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
    savedEnv.forEach(({ key, value }) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  };
}

describe.each([
  ['node build', isEdgeRuntimeInNodeBuild],
  ['browser build', isEdgeRuntimeInBrowserBuild],
])('isEdgeRuntime (%s) inside a browser Web Worker', (_build, isEdgeRuntime) => {
  let restoreGlobals: () => void;

  beforeEach(() => {
    restoreGlobals = installBrowserDedicatedWorkerScope();
  });

  afterEach(() => {
    restoreGlobals();
  });

  it('does not classify a browser dedicated worker global scope as an edge runtime', () => {
    expect('window' in globalThis).toBe(false);
    expect('EdgeRuntime' in globalThis).toBe(false);

    expect(isEdgeRuntime()).toBe(false);
  });
});
