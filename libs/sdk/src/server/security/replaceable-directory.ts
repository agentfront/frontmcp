import { dirname, stat } from '@frontmcp/utils';

const GROUP_OR_OTHER_WRITE = 0o022;
const STICKY_BIT = 0o1000;
const ROOT_UID = 0;

/** A directory whose entries another user could replace: `ownerUid` when another user owns it. */
export interface ReplaceableDirectory {
  directory: string;
  mode: number;
  ownerUid?: number;
}

/** The first of `start` and the directories above it that another user (not root) owns or the group or others can write without the sticky bit. */
export async function findReplaceableDirectory(start: string): Promise<ReplaceableDirectory | undefined> {
  for (let directory = start; ; directory = dirname(directory)) {
    const { mode, uid } = await stat(directory);
    if (uid !== ROOT_UID && uid !== process.getuid?.()) return { directory, mode, ownerUid: uid };
    if (mode & GROUP_OR_OTHER_WRITE && !(mode & STICKY_BIT)) return { directory, mode };
    if (dirname(directory) === directory) return undefined;
  }
}
