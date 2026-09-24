import 'reflect-metadata';

import { createTestFetchServer, rpc20260728 } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';

const WORKER_GLOBAL_KEYS = [
  'caches',
  'self',
  'WorkerGlobalScope',
  'DedicatedWorkerGlobalScope',
  'importScripts',
  'navigator',
];
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
  };
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'worker', name: 'Worker', tools: [PingTool] })
class WorkerApp {}

describe('Scope with elicitation inside a browser Web Worker', () => {
  let restoreGlobals: () => void;

  beforeEach(() => {
    restoreGlobals = installBrowserDedicatedWorkerScope();
  });

  afterEach(() => {
    restoreGlobals();
  });

  it('answers tools/list with the in-memory elicitation store instead of requiring distributed storage', async () => {
    const outcome = await createTestFetchServer({
      info: { name: 'worker-scope-elicitation', version: '1.0.0' },
      apps: [WorkerApp],
      elicitation: { enabled: true },
    })
      .then((server) => rpc20260728(server.handler, 'tools/list'))
      .then(
        ({ status }) => ({ status }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      );

    expect(outcome).toEqual({ status: 200 });
  });
});
