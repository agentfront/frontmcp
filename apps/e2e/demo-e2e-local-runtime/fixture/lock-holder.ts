/**
 * Another process holding the SQLite write lock: on "go" it opens a write transaction, prints
 * "locked", keeps the lock for HOLD_MS, then commits.
 */
import { loadBetterSqlite3 } from '@frontmcp/storage-sqlite';

import { readyThenWaitForGo, report, requiredEnv, runWorker, signal } from './worker-protocol';

runWorker(async () => {
  const BetterSqlite3 = loadBetterSqlite3();
  const db = new BetterSqlite3(requiredEnv('DB_PATH'));
  db.pragma('busy_timeout = 5000');
  await readyThenWaitForGo();

  db.exec('BEGIN IMMEDIATE');
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('held-by', 'lock-holder')").run();
  signal('locked');
  await new Promise((resolve) => setTimeout(resolve, Number(requiredEnv('HOLD_MS'))));
  db.exec('COMMIT');
  db.close();
  report({ released: true });
});
