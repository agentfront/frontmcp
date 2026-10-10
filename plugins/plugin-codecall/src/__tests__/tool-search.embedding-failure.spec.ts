import { EmbeddingService } from 'vectoriadb';

import { type ScopeEntry, type ToolEntry } from '@frontmcp/sdk';

import { ToolSearchService } from '../services/tool-search.service';

/**
 * With the `ml` strategy the embedding model is downloaded on first use. Offline, with no model in
 * the cache, that download fails. The server must keep running and search must keep answering.
 */

function createTool(name: string, description: string): ToolEntry<any, any> {
  return { name, fullName: name, metadata: { name, description } } as unknown as ToolEntry<any, any>;
}

function createScope(tools: ToolEntry<any, any>[]) {
  const warn = jest.fn();
  let toolChangeListener: ((event: { snapshot: unknown[] }) => void) | undefined;
  const scope = {
    logger: {
      warn,
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: () => scope.logger,
    },
    tools: {
      subscribe: jest.fn((options: { immediate?: boolean }, listener: (event: { snapshot: unknown[] }) => void) => {
        toolChangeListener = listener;
        if (options.immediate) listener({ snapshot: tools });
        return () => undefined;
      }),
    },
  } as unknown as ScopeEntry & { logger: { warn: jest.Mock } };
  const changeTools = (snapshot: ToolEntry<any, any>[]) => toolChangeListener?.({ snapshot });
  return { scope, warn, changeTools };
}

describe('ToolSearchService with the ml strategy when the model cannot be loaded', () => {
  const unhandled: unknown[] = [];
  const recordUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', recordUnhandled);
    EmbeddingService.setTransformersModule({
      pipeline: async () => {
        throw new TypeError('fetch failed');
      },
    });
  });

  afterEach(() => {
    process.off('unhandledRejection', recordUnhandled);
    EmbeddingService.clearTransformersModule();
  });

  async function settle() {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('does not leave an unhandled rejection behind', async () => {
    const { scope } = createScope([createTool('users_list', 'List all users')]);
    const service = new ToolSearchService({ strategy: 'ml' }, scope);
    await settle();

    expect(unhandled).toEqual([]);
    service.dispose();
  });

  it('logs one warning and still answers searches', async () => {
    const { scope, warn } = createScope([
      createTool('users_list', 'List all users'),
      createTool('invoices_create', 'Create an invoice'),
    ]);
    const service = new ToolSearchService({ strategy: 'ml' }, scope);
    await settle();

    const results = await service.search('list users');

    expect(results.map((result) => result.toolName)).toContain('users_list');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/embedding model/i);
    service.dispose();
  });

  it('searches with TF-IDF from then on, and warns only once', async () => {
    const { scope, warn, changeTools } = createScope([createTool('users_list', 'List all users')]);
    const service = new ToolSearchService({ strategy: 'ml' }, scope);
    await settle();

    changeTools([createTool('users_list', 'List all users'), createTool('invoices_create', 'Create an invoice')]);
    const results = await service.search('create invoice');

    expect(service.getStrategy()).toBe('tfidf');
    expect(results.map((result) => result.toolName)).toContain('invoices_create');
    expect(warn).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it('answers a search made while the model is still loading, once indexing is done', async () => {
    const { scope } = createScope([createTool('users_list', 'List all users')]);
    const service = new ToolSearchService({ strategy: 'ml' }, scope);

    const results = await service.search('list users');

    expect(results.map((result) => result.toolName)).toContain('users_list');
    service.dispose();
  });
});

describe('ToolSearchService when a tool change cannot be indexed', () => {
  it('logs a warning instead of leaving an unhandled rejection, and keeps serving searches', async () => {
    const unreadable = {
      name: 'broken',
      fullName: 'broken',
      get metadata(): never {
        throw new Error('metadata unavailable');
      },
    } as unknown as ToolEntry<any, any>;
    const { scope, warn, changeTools } = createScope([createTool('users_list', 'List all users')]);
    const service = new ToolSearchService({ strategy: 'tfidf' }, scope);

    changeTools([unreadable]);
    const results = await service.search('list users');

    expect(results).toEqual([]);
    expect(warn).toHaveBeenCalledWith('CodeCall tool search could not index the tools: metadata unavailable');
    service.dispose();
  });
});
