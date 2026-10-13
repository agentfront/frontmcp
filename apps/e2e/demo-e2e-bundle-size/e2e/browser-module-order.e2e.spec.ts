/**
 * The SDK's browser build is one module per source file, so the app's bundler decides which module evaluation enters
 * first. frontmcp.dev's Playground bundles it from two entry points that share chunks: one re-exports the SDK, the
 * other a plugin that imports it. create() and a tool call must work wherever evaluation enters.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { bundleEntriesWithSharedChunks, fixtureDir, workspaceRoot } from './helpers/browser-bundle';

const sdkBrowserDist = resolve(workspaceRoot, 'libs/sdk/dist/browser');
const greeting = { structuredContent: { value: 'Hello, FrontMCP' } };

function callGreetTool(sdkEntry: string, moduleToLoadFirst?: string): unknown {
  const runner = resolve(__dirname, 'helpers/call-greet-tool.mjs');
  const args = moduleToLoadFirst ? [runner, sdkEntry, moduleToLoadFirst] : [runner, sdkEntry];
  return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

describe('the browser build wherever module evaluation enters it', () => {
  it('serves a tool from a page bundle with two entry points that share chunks', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-split-bundle-'));
    try {
      await bundleEntriesWithSharedChunks(
        { runtime: resolve(fixtureDir, 'split-runtime.ts'), plugins: resolve(fixtureDir, 'split-plugins.ts') },
        outDir,
      );
      expect(callGreetTool(join(outDir, 'runtime.mjs'))).toMatchObject(greeting);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it.each(['common/schemas/annotated-class.schema.mjs'])(
    'serves a tool when %s is evaluated first',
    (moduleToLoadFirst) => {
      const sdkEntry = join(sdkBrowserDist, 'index.mjs');
      expect(callGreetTool(sdkEntry, join(sdkBrowserDist, moduleToLoadFirst))).toMatchObject(greeting);
    },
  );
});
