import { c } from '../../core/colors';
import type { ProcessManager } from './manager';

/**
 * Keep this process alive as the supervisor of `name` until it is told to stop.
 * The child is owned by this process, so returning early would orphan it.
 */
export function superviseUntilSignalled(pm: ProcessManager, name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.once('SIGINT', async () => {
      console.log(`\n${c('yellow', '[pm]')} stopping "${name}"...`);
      await pm.stop(name);
      resolve();
    });
    process.once('SIGTERM', async () => {
      await pm.stop(name);
      resolve();
    });
  });
}
