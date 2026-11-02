/**
 * The SDK's CommonJS and ESM entry points export the same names, each of the same kind, as the list pinned in
 * `fixtures/sdk-root-exports.json` (#950): loading a subsystem on first use changes none of them.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { readJSON } from '@frontmcp/utils';

import { workspaceRoot } from './helpers/browser-bundle';

const pinnedExports = () => readJSON<Record<string, string>>(resolve(__dirname, 'fixtures', 'sdk-root-exports.json'));

function exportKinds(entry: string, loader: 'require' | 'import'): Record<string, string> {
  const runner = resolve(__dirname, 'helpers', 'root-exports.mjs');
  return JSON.parse(
    execFileSync(process.execPath, [runner, resolve(workspaceRoot, entry), loader], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}

describe('the root exports of @frontmcp/sdk', () => {
  it('are the pinned names and kinds under require()', async () => {
    expect(exportKinds('libs/sdk/dist/index.js', 'require')).toEqual(await pinnedExports());
  });

  it('are the pinned names and kinds under import', async () => {
    expect(exportKinds('libs/sdk/dist/esm/index.mjs', 'import')).toEqual(await pinnedExports());
  });
});
