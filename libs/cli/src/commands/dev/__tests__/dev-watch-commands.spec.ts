/**
 * The two children `frontmcp dev` starts (#731).
 *
 * They used to be `npx.cmd -y tsx …` / `npx.cmd -y tsc …` without a shell on
 * Windows, which throws `spawn EINVAL` since Node's CVE-2024-27980 fix. Both
 * now run the project's own bin with node; npx is only the fallback.
 */
import * as os from 'os';
import * as path from 'path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { devWatchCommands } from '../dev';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

describe('devWatchCommands', () => {
  it("runs the project's tsx and tsc with node, not through npx", () => {
    const { app, checker } = devWatchCommands(REPO_ROOT, '/proj/src/main.ts');

    expect(app.command).toBe(process.execPath);
    expect(app.args[0]).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
    expect(app.args.slice(1)).toEqual(['--conditions', 'node', '--watch', '/proj/src/main.ts']);

    expect(checker.command).toBe(process.execPath);
    expect(checker.args[0]).toMatch(/typescript[\\/]bin[\\/]tsc$/);
    expect(checker.args.slice(1)).toEqual(['--noEmit', '--pretty', '--watch']);
  });

  describe('in a project without typescript', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-dev-watch-'));
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('type-checks through npx with the typescript package named (npx -y tsc fetches an unrelated package)', () => {
      const { checker } = devWatchCommands(dir, path.join(dir, 'src/main.ts'));
      expect(checker.label).toBe('npx');
      expect(checker.args.slice(-7)).toEqual([
        '-y',
        '--package',
        'typescript',
        'tsc',
        '--noEmit',
        '--pretty',
        '--watch',
      ]);
    });
  });
});
