/**
 * The stores a scope opens for persistent questions. On Node.js, a Redis named only for persistent questions
 * (`elicitation.persistent.storage`) keeps the elicitation state too, and both close with the scope. An edge runtime
 * has no store a question can be kept in, so persistent questions fail startup there with a reason, before either
 * store is opened.
 */

import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import { InvalidQuestionStoreError } from '../../elicitation/questions/question.errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

/** What the scope asked each store factory for. */
const mockStoreRequests: { elicitation: Array<Record<string, unknown>>; questions: Array<Record<string, unknown>> } = {
  elicitation: [],
  questions: [],
};

/** The storage each elicitation store the scope opened runs on, with its disconnects counted. */
const mockElicitationStorages: Array<{ disconnect: jest.Mock }> = [];

/** No Redis runs here: a Redis the scope names is stood in for by memory, once the request is recorded. */
const mockMemoryForRedis = (options: Record<string, unknown>) => {
  const storage = options['storage'] as { type?: string } | undefined;
  return storage?.type === 'redis' ? { ...options, storage: { type: 'memory' }, isEdgeRuntime: false } : options;
};

jest.mock('../../elicitation/store/elicitation-store.factory', () => {
  const actual = jest.requireActual('../../elicitation/store/elicitation-store.factory');
  return {
    ...actual,
    createElicitationStore: jest.fn(async (options: Record<string, unknown>) => {
      mockStoreRequests.elicitation.push(options);
      const result = await actual.createElicitationStore(mockMemoryForRedis(options));
      if (result.storage) {
        const disconnect = result.storage.disconnect.bind(result.storage);
        result.storage.disconnect = jest.fn(disconnect);
        mockElicitationStorages.push(result.storage);
      }
      return result;
    }),
  };
});

jest.mock('../../elicitation/questions/question-store.factory', () => {
  const actual = jest.requireActual('../../elicitation/questions/question-store.factory');
  return {
    ...actual,
    createQuestionStore: jest.fn(async (options: Record<string, unknown>) => {
      mockStoreRequests.questions.push(options);
      return actual.createQuestionStore(mockMemoryForRedis(options));
    }),
  };
});

interface StartedScope {
  persistentQuestions?: unknown;
  dispose(): Promise<void>;
}

const startedScopes: StartedScope[] = [];

/** `isEdgeRuntime()` is true while `EdgeRuntime` is a global. */
function withEdgeRuntime<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as Record<string, unknown>;
  const had = 'EdgeRuntime' in globals;
  const previous = globals['EdgeRuntime'];
  globals['EdgeRuntime'] = 'test';
  return run().finally(() => {
    if (had) globals['EdgeRuntime'] = previous;
    else delete globals['EdgeRuntime'];
  });
}

const QUESTIONS_REDIS = { type: 'redis', redis: { config: { host: 'redis.internal', port: 6379 } } } as const;

@App({ id: 'edge-questions', name: 'edge-questions' })
class EdgeQuestionsApp {}

describe('the stores of persistent questions', () => {
  afterEach(async () => {
    await Promise.all(startedScopes.splice(0).map((scope) => scope.dispose()));
    mockStoreRequests.elicitation.length = 0;
    mockStoreRequests.questions.length = 0;
    mockElicitationStorages.length = 0;
  });

  const withQuestionsRedis = () =>
    FrontMcpInstance.createForGraph({
      info: { name: 'edge-questions', version: '0.0.0' },
      apps: [EdgeQuestionsApp],
      elicitation: { enabled: true, persistent: { storage: QUESTIONS_REDIS } },
    });

  it('keeps the elicitation state in the Redis named for persistent questions', async () => {
    const instance = await withQuestionsRedis();
    const [scope] = instance.getScopes() as unknown as StartedScope[];
    startedScopes.push(scope);

    expect(mockStoreRequests.elicitation).toEqual([expect.objectContaining({ storage: QUESTIONS_REDIS })]);
    expect(mockStoreRequests.questions).toEqual([expect.objectContaining({ storage: QUESTIONS_REDIS })]);
    expect(scope.persistentQuestions).toBeDefined();
  });

  it('closes the connection of the elicitation store it opened when the scope is disposed', async () => {
    const instance = await withQuestionsRedis();
    const [scope] = instance.getScopes() as unknown as StartedScope[];
    expect(mockElicitationStorages).toHaveLength(1);

    await scope.dispose();

    expect(mockElicitationStorages[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['redis', QUESTIONS_REDIS],
    ['memory', { type: 'memory' }],
  ] as const)(
    'refuses persistent questions on an edge runtime, with the reason, before opening a store (%s)',
    async (_type, storage) => {
      const starting = withEdgeRuntime(() =>
        FrontMcpInstance.createForGraph({
          info: { name: 'edge-questions', version: '0.0.0' },
          apps: [EdgeQuestionsApp],
          elicitation: { enabled: true, persistent: { storage } },
        }),
      );

      await expect(starting).rejects.toThrow(InvalidQuestionStoreError);
      await expect(starting).rejects.toThrow(/not available on an edge runtime.*TCP connection/);
      expect(mockStoreRequests.elicitation).toEqual([]);
      expect(mockStoreRequests.questions).toEqual([]);
    },
  );
});
