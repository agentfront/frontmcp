/**
 * Widget sources ship with the build output (#649).
 *
 * `.widget.tsx` / `.widget.jsx` files are read from disk when the tool is called,
 * at the path the tool computed (`join(__dirname, 'queue.widget.tsx')`). tsc never
 * emits them, so the build copies them to where `__dirname` points at runtime:
 * the mirrored tree for tsc output (`preserve`), the bundle's own directory for
 * bundled output (`flat`).
 */
import * as os from 'os';
import * as path from 'path';

import { ensureDir, fileExists, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { copyWidgetSources, findWidgetSources, shipWidgetSources } from '../copy-widgets';

describe('widget source copy (#649)', () => {
  let tmp: string;
  let src: string;
  let out: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-649-widgets-'));
    src = path.join(tmp, 'src');
    out = path.join(tmp, 'dist', 'node');
    await ensureDir(src);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
  });

  async function put(rel: string, content = 'export default function W() { return null; }'): Promise<void> {
    const file = path.join(tmp, rel);
    await ensureDir(path.dirname(file));
    await writeFile(file, content);
  }

  describe('findWidgetSources', () => {
    it('finds *.widget.tsx and *.widget.jsx files, relative to the source root', async () => {
      await put('src/tools/queue.widget.tsx');
      await put('src/tools/nested/chart.widget.jsx');
      await put('src/root.widget.tsx');

      expect(await findWidgetSources(src, out)).toEqual([
        'root.widget.tsx',
        path.join('tools', 'nested', 'chart.widget.jsx'),
        path.join('tools', 'queue.widget.tsx'),
      ]);
    });

    it('ignores files that are not widgets', async () => {
      await put('src/tools/queue.tool.ts');
      await put('src/tools/widget.tsx');
      await put('src/tools/queue.widget.ts');
      await put('src/tools/queue.widget.tsx.bak');

      expect(await findWidgetSources(src, out)).toEqual([]);
    });

    it('skips node_modules and dot directories', async () => {
      await put('src/node_modules/pkg/a.widget.tsx');
      await put('src/.cache/b.widget.tsx');
      await put('src/c.widget.tsx');

      expect(await findWidgetSources(src, out)).toEqual(['c.widget.tsx']);
    });

    it('skips the build output when it sits inside the source root', async () => {
      // No rootDir: the entry is at the project root, so the source root contains dist/.
      await put('queue.widget.tsx');
      await put('dist/lambda/queue.widget.tsx'); // left by another target's build
      await put('dist/node/old.widget.tsx');

      expect(await findWidgetSources(tmp, out)).toEqual(['queue.widget.tsx']);
    });

    it('returns nothing for a missing source root', async () => {
      expect(await findWidgetSources(path.join(tmp, 'nope'), out)).toEqual([]);
    });
  });

  describe('copyWidgetSources', () => {
    it('preserve: mirrors the source tree under outDir, next to the compiled tools', async () => {
      await put('src/tools/queue.widget.tsx', 'QUEUE');
      await put('src/tools/nested/chart.widget.jsx', 'CHART');

      const result = await copyWidgetSources({ srcRoot: src, outDir: out, layout: 'preserve' });

      expect(result.copied).toEqual([
        path.join('tools', 'nested', 'chart.widget.jsx'),
        path.join('tools', 'queue.widget.tsx'),
      ]);
      expect(result.conflicts).toEqual([]);
      expect(await readFile(path.join(out, 'tools', 'queue.widget.tsx'))).toBe('QUEUE');
      expect(await readFile(path.join(out, 'tools', 'nested', 'chart.widget.jsx'))).toBe('CHART');
    });

    it('flat: puts every widget directly in outDir, where the bundle is', async () => {
      await put('src/tools/queue.widget.tsx', 'QUEUE');
      await put('src/tools/nested/chart.widget.jsx', 'CHART');

      const result = await copyWidgetSources({ srcRoot: src, outDir: out, layout: 'flat' });

      expect(result.copied).toEqual(['chart.widget.jsx', 'queue.widget.tsx']);
      expect(await readFile(path.join(out, 'queue.widget.tsx'))).toBe('QUEUE');
      expect(await readFile(path.join(out, 'chart.widget.jsx'))).toBe('CHART');
      expect(await fileExists(path.join(out, 'tools'))).toBe(false);
    });

    it('flat: skips a file name used by more than one widget and reports it', async () => {
      await put('src/a/card.widget.tsx');
      await put('src/b/card.widget.tsx');
      await put('src/queue.widget.tsx');

      const result = await copyWidgetSources({ srcRoot: src, outDir: out, layout: 'flat' });

      expect(result.copied).toEqual(['queue.widget.tsx']);
      expect(result.conflicts).toEqual([
        { name: 'card.widget.tsx', sources: [path.join('a', 'card.widget.tsx'), path.join('b', 'card.widget.tsx')] },
      ]);
      expect(await fileExists(path.join(out, 'card.widget.tsx'))).toBe(false);
    });

    it('creates nothing when there are no widgets', async () => {
      await put('src/tools/queue.tool.ts');

      const result = await copyWidgetSources({ srcRoot: src, outDir: out, layout: 'preserve' });

      expect(result).toEqual({ copied: [], conflicts: [] });
      expect(await fileExists(out)).toBe(false);
    });

    it('copies nothing when the output directory is the source root', async () => {
      await put('src/queue.widget.tsx');

      expect(await copyWidgetSources({ srcRoot: src, outDir: src, layout: 'preserve' })).toEqual({
        copied: [],
        conflicts: [],
      });
    });
  });

  describe('shipWidgetSources', () => {
    it('logs what it copied and each skipped name', async () => {
      await put('src/a/card.widget.tsx');
      await put('src/b/card.widget.tsx');
      await put('src/queue.widget.tsx');
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      await shipWidgetSources({ srcRoot: src, outDir: out, layout: 'flat', cwd: tmp, label: '[build:exec]' });

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((l) => l.includes('copied 1 widget source file') && l.includes(path.join('dist', 'node')))).toBe(
        true,
      );
      expect(lines.some((l) => l.includes('card.widget.tsx') && l.includes('rename'))).toBe(true);
    });

    it('logs nothing when there are no widgets', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      await shipWidgetSources({ srcRoot: src, outDir: out, layout: 'preserve', cwd: tmp, label: '[build]' });

      expect(log).not.toHaveBeenCalled();
    });
  });
});
