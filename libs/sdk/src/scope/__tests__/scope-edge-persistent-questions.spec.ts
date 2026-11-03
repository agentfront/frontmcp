/**
 * On an edge runtime, elicitation needs a distributed store. A Redis named only for persistent questions
 * (`elicitation.persistent.storage`) is one: the scope keeps its elicitation state there too, instead of failing
 * to start before the questions open.
 */

import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

/** What the scope asked each store factory for. */
const mockStoreRequests: { elicitation: Array<Record<string, unknown>>; questions: Array<Record<string, unknown>> } = {
  elicitation: [],
  questions: [],
};

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
      return actual.createElicitationStore(mockMemoryForRedis(options));
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

describe('persistent questions on an edge runtime', () => {
  afterEach(async () => {
    await Promise.all(startedScopes.splice(0).map((scope) => scope.dispose()));
    mockStoreRequests.elicitation.length = 0;
    mockStoreRequests.questions.length = 0;
  });

  it('keeps the elicitation state in the Redis named for persistent questions, and starts', async () => {
    const instance = await withEdgeRuntime(() =>
      FrontMcpInstance.createForGraph({
        info: { name: 'edge-questions', version: '0.0.0' },
        apps: [EdgeQuestionsApp],
        elicitation: { enabled: true, persistent: { storage: QUESTIONS_REDIS } },
      }),
    );
    const [scope] = instance.getScopes() as unknown as StartedScope[];
    startedScopes.push(scope);

    expect(mockStoreRequests.elicitation).toEqual([expect.objectContaining({ storage: QUESTIONS_REDIS })]);
    expect(mockStoreRequests.questions).toEqual([expect.objectContaining({ storage: QUESTIONS_REDIS })]);
    expect(scope.persistentQuestions).toBeDefined();
  });

  it('still refuses persistent questions kept in memory, which an edge runtime cannot share', async () => {
    await expect(
      withEdgeRuntime(() =>
        FrontMcpInstance.createForGraph({
          info: { name: 'edge-questions', version: '0.0.0' },
          apps: [EdgeQuestionsApp],
          elicitation: { enabled: true, persistent: { storage: { type: 'memory' } } },
        }),
      ),
    ).rejects.toThrow(/distributed storage when running on Edge runtime/);
    expect(mockStoreRequests.elicitation).toEqual([expect.not.objectContaining({ storage: expect.anything() })]);
  });
});
