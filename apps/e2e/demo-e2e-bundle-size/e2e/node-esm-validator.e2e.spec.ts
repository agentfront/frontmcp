/**
 * An ESM process loads the MCP SDK's JSON Schema validator from the build its MCP server comes from, and no second
 * copy from the other build (#951).
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { workspaceRoot } from './helpers/browser-bundle';

function modulesLoadedBy(entry: string, pattern: RegExp): string[] {
  const runner = resolve(__dirname, 'helpers', 'loaded-modules.mjs');
  const loaded: string[] = JSON.parse(
    execFileSync(process.execPath, [runner, entry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  );
  return loaded.filter((url) => pattern.test(url));
}

describe("the MCP server's JSON Schema validator under ESM", () => {
  it('loads from the same build as the MCP server', () => {
    const loaded = modulesLoadedBy(
      resolve(workspaceRoot, 'libs/sdk/dist/esm/index.mjs'),
      /\/@modelcontextprotocol\/server\/dist\/(index|validators\/ajv)\.(mjs|cjs)$/,
    );

    // A build is the file extension: `.mjs` for ESM, `.cjs` for CommonJS
    const buildsOf = (module: string) =>
      loaded
        .filter((url) => url.includes(`/@modelcontextprotocol/server/dist/${module}.`))
        .map((url) => url.split('.').pop());
    expect(buildsOf('index')).toHaveLength(1);
    expect(buildsOf('validators/ajv')).toEqual(buildsOf('index'));
  });
});
