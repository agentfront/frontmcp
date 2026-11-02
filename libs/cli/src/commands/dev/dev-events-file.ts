import * as path from 'path';

import { appendFile, ensureDir, writeFile } from '@frontmcp/utils';

/** Empties the events file of a new `frontmcp dev` run, creating its folder; false, after a warning, when it cannot. */
export async function startEventsFile(file: string, warn: (message: string) => void): Promise<boolean> {
  try {
    await ensureDir(path.dirname(file));
    await writeFile(file, '');
    return true;
  } catch (error) {
    warn(`dev events are off: could not create ${file} (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
}

/** Clears the variables that make the server write dev events, or send them over IPC. */
export function turnDevEventsOff(env: NodeJS.ProcessEnv): void {
  env['FRONTMCP_DEV_EVENTS_FILE'] = '';
  env['FRONTMCP_DEV_EVENTS_IPC'] = '';
}

export interface DevEventsWriter {
  /** Queues a batch of events to append, one JSON line each, after the batches before it. */
  write(events: readonly unknown[]): void;
  flush(): Promise<void>;
}

/** Appends the events a `--stdio --serve` server sends over IPC; the first write failure is logged, never thrown. */
export function createDevEventsWriter(
  file: string,
  log: { warn(message: string, data?: Record<string, unknown>): void },
): DevEventsWriter {
  let writing = Promise.resolve();
  let failed = false;
  return {
    write(events) {
      const lines = events.map((event) => `${JSON.stringify(event)}\n`).join('');
      writing = writing
        .then(() => appendFile(file, lines))
        .catch((error: unknown) => {
          if (failed) return;
          failed = true;
          log.warn('dev-events-write-failed', { file, error: error instanceof Error ? error.message : String(error) });
        });
    },
    flush: () => writing,
  };
}
