import 'reflect-metadata';

import {
  App,
  FrontMcp,
  OffloadBudgetExceededError,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type OffloadCallOptions,
  type OffloadModuleRef,
} from '@frontmcp/sdk';

declare function countWords(text: string, minLength: number): number;

const wordCounter: OffloadModuleRef = { module: new URL('file:///srv/count-words.js'), export: 'countWords' };

@Tool({ name: 'count_words', inputSchema: {} })
export class CountWordsTool extends ToolContext {
  async execute() {
    const options: OffloadCallOptions = { budgetMs: 2_000, signal: this.signal };
    const words: number = await this.offload<typeof countWords>(wordCounter, ['a long text', 3], options);
    // @ts-expect-error the arguments follow the offloaded function's parameters
    await this.offload<typeof countWords>(wordCounter, [3, 'a long text']);
    const anything: unknown = await this.offload({ module: '/srv/anything.js' }, []);
    try {
      return { words, anything };
    } catch (error) {
      if (error instanceof OffloadBudgetExceededError) return { words: error.budgetMs, anything };
      throw error;
    }
  }
}

@Resource({ name: 'repo-index', uri: 'repo://index', worker: true })
export class RepoIndex extends ResourceContext {
  async execute() {
    return { files: 0 };
  }
}

@ResourceTemplate({ name: 'repo-file', uriTemplate: 'repo://files/{path}', worker: { budgetMs: 5_000 } })
export class RepoFile extends ResourceContext<{ path: string }> {
  async execute(_uri: string, params: { path: string }) {
    return { path: params.path };
  }
}

// @ts-expect-error worker is true or { budgetMs }
@Resource({ name: 'repo-stats', uri: 'repo://stats', worker: 'yes' })
export class RepoStats extends ResourceContext {
  async execute() {
    return {};
  }
}

@App({ name: 'repo', tools: [CountWordsTool], resources: [RepoIndex, RepoFile] })
class RepoApp {}

@FrontMcp({
  info: { name: 'offload', version: '1.0.0' },
  apps: [RepoApp],
  offload: { maxWorkers: 2, idleTimeoutMs: 10_000, budgetMs: 15_000, env: ['NODE_ENV', 'TZ'] },
})
export class OffloadServer {}

@FrontMcp({
  info: { name: 'offload-typo', version: '1.0.0' },
  apps: [RepoApp],
  // @ts-expect-error budgetMs is a number of milliseconds
  offload: { budgetMs: '15s' },
})
export class OffloadTypoServer {}
