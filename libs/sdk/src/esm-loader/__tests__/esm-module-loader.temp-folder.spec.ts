import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importComputed } from '#import-computed';

import type { EsmCacheManager } from '../esm-cache';
import { EsmModuleLoader } from '../esm-module-loader';

jest.mock('#import-computed', () => ({ importComputed: jest.fn(async () => ({ default: {} })) }));

const bundle = 'export default { name: "temp-folder-check" };';

describe('an ESM bundle imported from its source text on Node', () => {
  it('is written to a folder of its own that only this user can open, never a shared temp folder', async () => {
    const loader = new EsmModuleLoader({ cache: {} as EsmCacheManager });

    await (loader as unknown as { importBundle(source: string): Promise<unknown> }).importBundle(bundle);

    const imported = String(jest.mocked(importComputed).mock.calls.at(-1)?.[0]);
    expect(imported.startsWith('file:')).toBe(true);
    const folder = path.dirname(fileURLToPath(imported));
    try {
      expect(folder).not.toBe(path.join(os.tmpdir(), 'frontmcp-esm-modules'));
      expect(await fs.readFile(fileURLToPath(imported), 'utf8')).toBe(bundle);
      expect((await fs.stat(folder)).mode & 0o077).toBe(0);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});
