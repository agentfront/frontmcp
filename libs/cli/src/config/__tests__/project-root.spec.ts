import * as path from 'path';

import { absolutizePathOptions, enterConfigRoot } from '../project-root';

describe('enterConfigRoot (#679)', () => {
  const root = path.resolve('/work/app');
  const sub = path.join(root, 'src');

  it('moves to the folder of a config found above the cwd', () => {
    const chdir = jest.fn();
    expect(enterConfigRoot({ configDir: root, configSource: 'search' }, sub, chdir)).toBe(root);
    expect(chdir).toHaveBeenCalledWith(root);
  });

  it('stays put when the config is in the cwd', () => {
    const chdir = jest.fn();
    expect(enterConfigRoot({ configDir: root, configSource: 'search' }, root, chdir)).toBe(root);
    expect(chdir).not.toHaveBeenCalled();
  });

  it('does not move for an explicit --config / FRONTMCP_CONFIG', () => {
    const chdir = jest.fn();
    expect(enterConfigRoot({ configDir: path.join(root, 'configs'), configSource: 'explicit' }, root, chdir)).toBe(
      root,
    );
    expect(chdir).not.toHaveBeenCalled();
  });

  it('does not move without a config', () => {
    const chdir = jest.fn();
    expect(enterConfigRoot({}, sub, chdir)).toBe(sub);
    expect(chdir).not.toHaveBeenCalled();
  });
});

describe('absolutizePathOptions', () => {
  it('resolves the named string options against the given directory', () => {
    const from = path.resolve('/work/app/src');
    const result = absolutizePathOptions(
      { entry: './main.ts', outDir: '../out', icon: undefined, port: 3000, keep: 'x' },
      ['entry', 'outDir', 'icon', 'port'],
      from,
    );
    expect(result).toEqual({
      entry: path.join(from, 'main.ts'),
      outDir: path.resolve(from, '../out'),
      icon: undefined,
      port: 3000,
      keep: 'x',
    });
  });

  it('keeps absolute paths and does not mutate its input', () => {
    const opts = { entry: path.resolve('/abs/main.ts'), outDir: '' };
    const result = absolutizePathOptions(opts, ['entry', 'outDir'], path.resolve('/elsewhere'));
    expect(result).toEqual({ entry: path.resolve('/abs/main.ts'), outDir: '' });
    expect(result).not.toBe(opts);
  });
});
