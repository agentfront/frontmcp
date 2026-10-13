/**
 * The SDK's browser build is one module per source file, so the app's bundler decides which module evaluation enters
 * first. frontmcp.dev's Playground bundles it from two entry points that share chunks: one re-exports the SDK, the
 * other a plugin that imports it. create() and a tool call must work wherever evaluation enters. A Worker, by contrast,
 * gets one file without shared chunks from wrangler, and must find the SDK's exports initialized as it loads.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { bundleAsWorker, bundleEntriesWithSharedChunks, fixtureDir, workspaceRoot } from './helpers/browser-bundle';

const sdkBrowserDist = resolve(workspaceRoot, 'libs/sdk/dist/browser');
const greeting = { structuredContent: { value: 'Hello, FrontMCP' } };

function runHelper(helper: string, args: string[]): unknown {
  const runner = resolve(__dirname, 'helpers', helper);
  return JSON.parse(
    execFileSync(process.execPath, [runner, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  );
}

function callGreetTool(sdkEntry: string, moduleToLoadFirst?: string): unknown {
  return runHelper('call-greet-tool.mjs', moduleToLoadFirst ? [sdkEntry, moduleToLoadFirst] : [sdkEntry]);
}

describe('the browser build wherever module evaluation enters it', () => {
  it('serves a tool from a Worker bundle that reads FrontMcpInstance as it loads', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-worker-bundle-'));
    try {
      const workerBundle = join(outDir, 'worker.mjs');
      await bundleAsWorker(resolve(fixtureDir, 'worker-fetch-handler.ts'), workerBundle);
      expect(runHelper('call-greet-over-fetch.mjs', [workerBundle])).toMatchObject(greeting);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('serves a tool from a page bundle with two entry points that share chunks', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-split-bundle-'));
    try {
      await bundleEntriesWithSharedChunks(
        { runtime: resolve(fixtureDir, 'split-runtime.ts'), plugins: resolve(fixtureDir, 'split-plugins.ts') },
        outDir,
      );
      expect(callGreetTool(join(outDir, 'runtime.mjs'))).toMatchObject(greeting);
      expect(callGreetTool(join(outDir, 'runtime.mjs'), join(outDir, 'plugins.mjs'))).toMatchObject(greeting);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it.each(['common/schemas/annotated-class.schema.mjs', 'common/interfaces/execution-context.interface.mjs'])(
    'serves a tool when %s is evaluated first',
    (moduleToLoadFirst) => {
      const sdkEntry = join(sdkBrowserDist, 'index.mjs');
      expect(callGreetTool(sdkEntry, join(sdkBrowserDist, moduleToLoadFirst))).toMatchObject(greeting);
    },
  );
});
