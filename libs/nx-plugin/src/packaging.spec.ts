import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { minimatch } from 'minimatch';

type Asset = string | { input: string; glob: string; output: string };

const pluginRoot = join(__dirname, '..');
const srcRoot = join(pluginRoot, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function srcAssetGlobs(): string[] {
  const project = JSON.parse(readFileSync(join(pluginRoot, 'project.json'), 'utf8'));
  const assets: Asset[] = project.targets['build-tsc'].options.assets;
  return assets
    .filter((a): a is Exclude<Asset, string> => typeof a !== 'string' && a.input === 'libs/nx-plugin/src')
    .map((a) => a.glob);
}

describe('published package contents', () => {
  const templates = walk(srcRoot)
    .filter((f) => f.endsWith('__tmpl__'))
    .map((f) => relative(srcRoot, f).split('\\').join('/'));

  it('finds generator templates to verify', () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it('copies every generator template into dist (lib generator needs lib-project-files)', () => {
    const globs = srcAssetGlobs();
    const uncovered = templates.filter((t) => !globs.some((g) => minimatch(t, g, { dot: true })));
    expect(uncovered).toEqual([]);
  });

  it('includes the lib generator project templates specifically', () => {
    const globs = srcAssetGlobs();
    const path = 'generators/lib/lib-project-files/project.json__tmpl__';
    expect(globs.some((g) => minimatch(path, g, { dot: true }))).toBe(true);
  });
});
