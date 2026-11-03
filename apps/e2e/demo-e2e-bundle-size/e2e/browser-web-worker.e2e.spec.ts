/**
 * A server create() builds in a browser Web Worker (#1031). webpack's `target: 'webworker'`, and esbuild or Rollup given
 * the `worker` condition, resolve with `worker` and `browser`: the worker must get the browser variants of
 * @frontmcp/utils, @frontmcp/auth and @frontmcp/protocol, as a page does, and run without `process`.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { bundleWebWorkerWithEsbuild, bundleWebWorkerWithWebpack, fixtureDir } from './helpers/browser-bundle';

const NODE_VARIANTS =
  /^libs\/(utils|auth)\/dist\/(esm\/index\.mjs|index\.js)$|^libs\/utils\/dist\/(esm\/)?(crypto\/node|env\/runtime-context|[a-z-]+\/node-[a-z-]+)\.m?js$|^libs\/protocol\/dist\/(esm\/)?node-[a-z-]+\.m?js$/;

const BUNDLERS = [
  { bundler: "webpack's target: 'webworker'", bundle: bundleWebWorkerWithWebpack },
  { bundler: "esbuild's conditions: ['worker']", bundle: bundleWebWorkerWithEsbuild },
];

function runInWebWorker(workerBundle: string): unknown {
  const runner = resolve(__dirname, 'helpers/run-in-web-worker.mjs');
  return JSON.parse(
    execFileSync(process.execPath, [runner, workerBundle], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    }),
  );
}

describe('create() + one tool in a browser Web Worker', () => {
  it.each(BUNDLERS)('serves the tool without process from a bundle made by $bundler', async ({ bundle }) => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-web-worker-'));
    try {
      const workerBundle = join(outDir, 'worker.mjs');
      const inputs = await bundle(resolve(fixtureDir, 'web-worker-create-tool.mjs'), workerBundle);
      expect(inputs.filter((input) => NODE_VARIANTS.test(input))).toEqual([]);
      expect(runInWebWorker(workerBundle)).toMatchObject({
        result: { structuredContent: { value: 'Hello, FrontMCP' } },
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
