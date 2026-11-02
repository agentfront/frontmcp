/** E2E: `reapOrphans(marker)` stops the processes marked by an owner that is gone, and leaves every other process alone. */
import { randomUUID, reapOrphans, spawnOwned, type OwnedProcess } from '@frontmcp/utils';

import type { OrphanOwnerResult } from '../fixture/orphan-owner';
import { spawnWorker } from './helpers/workers';

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

(process.platform === 'win32' ? describe.skip : describe)('reapOrphans', () => {
  const leftovers: number[] = [];
  let ours: OwnedProcess | undefined;

  afterEach(async () => {
    for (const pid of leftovers.splice(0)) if (running(pid)) process.kill(pid, 'SIGKILL');
    await ours?.stop('SIGKILL', 1000);
    ours = undefined;
  });

  it('stops marked orphans and leaves unmarked processes and live owners alone', async () => {
    const marker = `e2e-reap-${randomUUID().slice(0, 8)}`;
    ours = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--'], {
      marker,
      detached: true,
      stdio: 'ignore',
    });
    const { marked, unmarked } = await spawnWorker<OrphanOwnerResult>('orphan-owner.ts', { MARKER: marker }).result;
    leftovers.push(marked, unmarked);
    expect(running(marked)).toBe(true);

    const reaped = await reapOrphans(marker);

    expect(reaped).toEqual([marked]);
    expect(running(marked)).toBe(false);
    expect(running(unmarked)).toBe(true);
    expect(ours.child.exitCode).toBeNull();
    await expect(reapOrphans(marker)).resolves.toEqual([]);
  });
});
