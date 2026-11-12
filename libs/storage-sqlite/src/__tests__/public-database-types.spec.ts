import { openDatabase } from '../open-database';
import { acquireConnection } from '../sqlite-connection';
import { SqliteEventStore } from '../sqlite-event.store';
import { SqliteKvStore } from '../sqlite-kv.store';
import { SqliteTaskStore } from '../sqlite-task.store';

const IN_MEMORY = { path: ':memory:', ttlCleanupIntervalMs: 0 };

/** Type-checked by `nx typecheck storage-sqlite`: each call below uses a member only better-sqlite3's types have. */
describe("the public database members keep better-sqlite3's types", () => {
  it('openDatabase() returns a database with pluck()', () => {
    const database = openDatabase(':memory:', 'Test');

    expect(database.prepare('SELECT 1').pluck().get()).toBe(1);
    database.close();
  });

  it('SqliteConnection#db is a database with iterate()', () => {
    const connection = acquireConnection(':memory:', 'Test');

    expect([...connection.db.prepare('SELECT 1 AS one').iterate()]).toEqual([{ one: 1 }]);
    connection.release();
  });

  it("the stores' getDatabase() returns a database with bind()", async () => {
    const kv = new SqliteKvStore(IN_MEMORY);
    const events = new SqliteEventStore(IN_MEMORY);
    const tasks = new SqliteTaskStore(IN_MEMORY);

    for (const store of [kv, events, tasks]) {
      expect(store.getDatabase().prepare('SELECT ?').pluck().bind(2).get()).toBe(2);
    }
    kv.close();
    events.close();
    await tasks.destroy();
  });
});
