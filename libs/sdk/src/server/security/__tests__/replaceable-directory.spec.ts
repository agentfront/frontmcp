import { lstat, stat } from '@frontmcp/utils';

import { findReplaceableDirectory } from '../replaceable-directory';

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  lstat: jest.fn(),
  stat: jest.fn(),
}));

const me = process.getuid?.() ?? 501;
const otherUser = me + 4242;

interface Entry {
  uid: number;
  mode: number;
  link?: { uid: number };
}

/** Serve lstat and stat from a fake file tree of directories and links to them. */
function fakeTree(entries: Record<string, Entry>): void {
  const entryOf = (path: string): Entry => {
    const entry = entries[path];
    if (!entry) throw new Error(`no fake entry for ${path}`);
    return entry;
  };
  jest.mocked(stat).mockImplementation(async (path) => {
    const { uid, mode } = entryOf(String(path));
    return { uid, mode } as never;
  });
  jest.mocked(lstat).mockImplementation(async (path) => {
    const { uid, mode, link } = entryOf(String(path));
    return { uid: link?.uid ?? uid, mode: link ? 0o120777 : mode, isSymbolicLink: () => link !== undefined } as never;
  });
}

describe('findReplaceableDirectory', () => {
  it('finds a link another user owns in a sticky directory, though the directory it points to is ours', async () => {
    fakeTree({
      '/tmp/run': { uid: me, mode: 0o40700, link: { uid: otherUser } },
      '/tmp': { uid: 0, mode: 0o41777 },
      '/': { uid: 0, mode: 0o40755 },
    });

    await expect(findReplaceableDirectory('/tmp/run')).resolves.toEqual({
      directory: '/tmp/run',
      mode: 0o120777,
      ownerUid: otherUser,
    });
  });

  it('accepts links that root or this user owns', async () => {
    fakeTree({
      '/tmp/run': { uid: me, mode: 0o40700, link: { uid: me } },
      '/tmp': { uid: 0, mode: 0o41777, link: { uid: 0 } },
      '/': { uid: 0, mode: 0o40755 },
    });

    await expect(findReplaceableDirectory('/tmp/run')).resolves.toBeUndefined();
  });
});
