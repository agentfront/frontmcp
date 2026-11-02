/**
 * An ESM process loads the MCP client the first time a direct client or a remote app connects, as a CommonJS one
 * does (#951): importing the SDK's ESM build loads none of it.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { workspaceRoot } from './helpers/browser-bundle';

type ClientLoad = { beforeConnect: string[]; afterConnect: string[]; result: unknown };

function connectDirectClient(sdkEntry: string): ClientLoad {
  const runner = resolve(__dirname, 'helpers', 'connect-direct-client.mjs');
  return JSON.parse(
    execFileSync(process.execPath, [runner, sdkEntry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  );
}

describe('the MCP client of the SDK under ESM', () => {
  it('loads with the first connect(), not with the SDK', () => {
    const { beforeConnect, afterConnect, result } = connectDirectClient(
      resolve(workspaceRoot, 'libs/sdk/dist/esm/index.mjs'),
    );

    expect(beforeConnect).toEqual([]);
    expect(afterConnect).toEqual(
      expect.arrayContaining([expect.stringMatching(/@modelcontextprotocol\/sdk\/dist\/esm\/client\/index\.js$/)]),
    );
    expect(result).toMatchObject({ structuredContent: { value: 'Hello, FrontMCP' } });
  });
});
