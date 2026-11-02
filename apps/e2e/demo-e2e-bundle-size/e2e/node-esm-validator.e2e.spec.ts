/**
 * An ESM process loads the MCP SDK's JSON Schema validator from the build its MCP server comes from, and no second
 * copy from the other build (#951).
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { workspaceRoot } from './helpers/browser-bundle';

function modulesLoadedBy(entry: string, pattern: string): string[] {
  const runner = resolve(__dirname, 'helpers', 'loaded-modules.mjs');
  return JSON.parse(
    execFileSync(process.execPath, [runner, entry, pattern], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  );
}

describe("the MCP server's JSON Schema validator under ESM", () => {
  it('loads from the same build as the MCP server', () => {
    const loaded = modulesLoadedBy(
      resolve(workspaceRoot, 'libs/sdk/dist/esm/index.mjs'),
      '/@modelcontextprotocol/sdk/dist/(esm|cjs)/(server/index|validation/ajv-provider)\\.js$',
    );

    const buildsOf = (module: string) =>
      loaded
        .filter((url) => url.endsWith(`/${module}`))
        .map((url) => url.split('/@modelcontextprotocol/sdk/dist/')[1].split('/')[0]);
    expect(buildsOf('server/index.js')).toHaveLength(1);
    expect(buildsOf('validation/ajv-provider.js')).toEqual(buildsOf('server/index.js'));
  });
});
