import { isMainThread } from 'node:worker_threads';

import { Resource, ResourceContext, ResourceNotFoundError, ResourceTemplate } from '@frontmcp/sdk';

import { HEAVY_MS, spin } from './spin';

@Resource({ name: 'heavy-report', uri: 'report://heavy', mimeType: 'application/json', worker: true })
export class HeavyReport extends ResourceContext {
  async execute(uri: string) {
    this.logger.info(`building ${uri}`);
    return { uri, isMainThread, turns: spin(HEAVY_MS) };
  }
}

@Resource({ name: 'stuck-report', uri: 'report://stuck', mimeType: 'application/json', worker: { budgetMs: 300 } })
export class StuckReport extends ResourceContext {
  async execute(): Promise<never> {
    for (;;) spin(1000);
  }
}

@ResourceTemplate({ name: 'missing-report', uriTemplate: 'report://missing/{id}', worker: true })
export class MissingReport extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<never> {
    throw new ResourceNotFoundError(uri);
  }
}

@Resource({ name: 'inline-report', uri: 'report://inline', mimeType: 'application/json' })
export class InlineReport extends ResourceContext {
  async execute(uri: string) {
    return { uri, isMainThread, turns: spin(HEAVY_MS) };
  }
}
