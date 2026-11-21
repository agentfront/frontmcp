/**
 * E2E: CodeCall in a Cloudflare Worker (workerd).
 *
 * Builds the CodeCall fixture with `frontmcp build --target cloudflare`, bundles it as
 * `wrangler deploy` would, and runs that bundle in workerd. Two things are checked:
 *
 * - The bundle: Enclave's Node-only barrel (`@enclave-vm/core`, built on `node:vm` and worker
 *   threads, which `nodejs_compat` only stubs) must not be in it; its worker-safe entry point
 *   (`@enclave-vm/core/worker`) is what the bundle carries.
 * - The behaviour: the Worker boots with CodeCall, serves its tools, and
 *   refuses to run one in the Node VM runtime with a clear error instead of reaching a stub.
 */
import * as path from 'node:path';

import { readFile } from '@frontmcp/utils';

import { CodecallWorker } from './helpers/codecall-worker';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const ENCLAVE_CORE_DIR = path.join(ROOT_DIR, 'node_modules', '@enclave-vm', 'core');

/**
 * Text that only the full Enclave barrel holds: its Node VM check, its worker-thread pool and its
 * double VM. Each is verified below to be in the barrel's build and not in the worker entry's.
 */
const NODE_BARREL_MARKERS = [
  'needs node:vm, which this runtime does not provide',
  'WorkerPoolAdapter',
  'wrapWithDoubleVm',
];

/** Text the worker entry's interpreter holds (and the barrel too). */
const WORKER_ENTRY_MARKER = 'cannot be given to the interpreter: it supports JSON data only';

describe('CodeCall on Cloudflare Workers (workerd)', () => {
  let worker: CodecallWorker;

  beforeAll(async () => {
    worker = await CodecallWorker.start();
  }, 170000);

  afterAll(async () => {
    await worker?.stop();
  });

  describe('the bundle', () => {
    let barrel: string;
    let workerEntry: string;

    beforeAll(async () => {
      [barrel, workerEntry] = await Promise.all([
        readFile(path.join(ENCLAVE_CORE_DIR, 'esm', 'index.mjs')),
        readFile(path.join(ENCLAVE_CORE_DIR, 'esm', 'worker.mjs')),
      ]);
    });

    it.each(NODE_BARREL_MARKERS)('identifies the Node barrel by %p', (marker) => {
      expect(barrel).toContain(marker);
      expect(workerEntry).not.toContain(marker);
    });

    it("leaves Enclave's Node-only barrel out", () => {
      for (const marker of NODE_BARREL_MARKERS) expect(worker.bundle).not.toContain(marker);
      expect(worker.bundle).not.toMatch(/from\s*["'](?:node:)?(?:vm|worker_threads)["']/);
    });

    it("carries Enclave's worker-safe entry point", () => {
      expect(workerEntry).toContain(WORKER_ENTRY_MARKER);
      expect(worker.bundle).toContain(WORKER_ENTRY_MARKER);
    });
  });

  describe('the Worker', () => {
    it('serves the CodeCall tools', async () => {
      const names = await worker.listTools();
      expect(names).toEqual(expect.arrayContaining(['codecall:search', 'codecall:describe', 'codecall:execute']));
    });

    it('describes a tool', async () => {
      const result = await worker.callTool<{ tools?: Array<{ name: string }> }>('codecall:describe', {
        toolNames: ['users.get'],
      });
      expect(result.tools?.map((tool) => tool.name)).toEqual(['users.get']);
    });

    it('refuses to run a script in the Node VM runtime, naming the runtime that works here', async () => {
      const outcome = await worker.execute("return await callTool('users.get', { id: 1 });");

      expect(outcome).toEqual({
        status: 'runtime_error',
        error: {
          source: 'script',
          name: 'CodeCallRuntimeError',
          message:
            "CodeCall vm.runtime 'node-vm' needs Node.js (node:vm); it is not available in Cloudflare Workers. " +
            "Set vm.runtime: 'interpreter' to run scripts in a Worker.",
        },
      });
    });
  });
});
