import { durableObjectSqlite, useSqliteDriver } from '@frontmcp/storage-sqlite';

import { fakeDurableObjectStorage } from '../../../../storage-sqlite/src/__test-utils__/fake-durable-object-storage';
import { openPersistentQuestions } from '../../elicitation/questions/question-scope.helper';
import { InvalidQuestionStoreError } from '../../elicitation/questions/question.errors';
import { createElicitationStore } from '../../elicitation/store/elicitation-store.factory';
import { ElicitationNotSupportedError } from '../../errors/elicitation.error';
import { createTaskStore, TaskStoreNotSupportedError } from '../../task/store/task-store.factory';

const SQLITE = { path: 'server.sqlite', ttlCleanupIntervalMs: 0 };
const QUESTIONS_IN_SQLITE = { storage: { type: 'sqlite' as const, sqlite: SQLITE } };
const NAMES_THE_DRIVER = /without a SQLite driver.*useSqliteDriver\(durableObjectSqlite\(ctx\.storage\)\)/;
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never;

describe('a SQLite store on an edge runtime', () => {
  afterEach(() => useSqliteDriver(undefined));

  describe("with a Durable Object's driver set", () => {
    beforeEach(() => useSqliteDriver(durableObjectSqlite(fakeDurableObjectStorage())));

    it('builds the task store, which keeps a task', async () => {
      const { store, type } = await createTaskStore({ sqlite: SQLITE, isEdgeRuntime: true });
      const now = Date.now();

      await store.create({
        taskId: 'task-1',
        sessionId: 'session-1',
        status: 'working',
        createdAt: new Date(now).toISOString(),
        lastUpdatedAt: new Date(now).toISOString(),
        ttlMs: 60_000,
        expiresAt: now + 60_000,
        request: { method: 'tools/call', params: {} },
      });

      expect(type).toBe('sqlite');
      await expect(store.get('task-1', 'session-1')).resolves.toMatchObject({ taskId: 'task-1', status: 'working' });
      await store.destroy?.();
    });

    it('builds the elicitation store, which keeps a pending elicitation', async () => {
      const { store, type } = await createElicitationStore({
        sqlite: SQLITE,
        isEdgeRuntime: true,
        encryption: { enabled: false },
      });
      const now = Date.now();

      await store.setPending({
        elicitId: 'elicit-1',
        sessionId: 'session-1',
        createdAt: now,
        expiresAt: now + 60_000,
        message: 'Which account?',
        mode: 'form',
      });

      expect(type).toBe('sqlite');
      await expect(store.getPending('session-1')).resolves.toMatchObject({ elicitId: 'elicit-1' });
      await store.destroy?.();
    });

    it('opens persistent questions on the SQLite store they name, and on no other store', async () => {
      const questions = await openPersistentQuestions({ persistent: QUESTIONS_IN_SQLITE, onEdgeRuntime: true, logger });
      const inMemory = openPersistentQuestions({
        persistent: { storage: { type: 'memory' } },
        onEdgeRuntime: true,
        logger,
      });

      expect(questions?.type).toBe('sqlite');
      await expect(inMemory).rejects.toThrow(/not available on an edge runtime/);
      await questions?.store.close();
    });
  });

  describe('without a driver', () => {
    it('refuses the task store, and names the driver that would open it', async () => {
      const creating = createTaskStore({ sqlite: SQLITE, isEdgeRuntime: true });

      await expect(creating).rejects.toBeInstanceOf(TaskStoreNotSupportedError);
      await expect(creating).rejects.toThrow(NAMES_THE_DRIVER);
    });

    it('refuses the elicitation store, and names the driver that would open it', async () => {
      const creating = createElicitationStore({ sqlite: SQLITE, isEdgeRuntime: true });

      await expect(creating).rejects.toBeInstanceOf(ElicitationNotSupportedError);
      await expect(creating).rejects.toThrow(NAMES_THE_DRIVER);
    });

    it('refuses persistent questions, and names the driver that would open their SQLite store', async () => {
      const opening = openPersistentQuestions({ persistent: QUESTIONS_IN_SQLITE, onEdgeRuntime: true, logger });

      await expect(opening).rejects.toBeInstanceOf(InvalidQuestionStoreError);
      await expect(opening).rejects.toThrow(/not available on an edge runtime.*useSqliteDriver\(durableObjectSqlite/);
    });
  });
});
