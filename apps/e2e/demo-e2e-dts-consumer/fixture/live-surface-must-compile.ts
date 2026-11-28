import 'reflect-metadata';

import {
  App,
  fileSignal,
  FrontMcp,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  SURFACE_META_KEY,
  Tool,
  ToolContext,
  type EnabledEntryRef,
  type EnabledResolver,
  type EnabledSource,
  type GetPromptResult,
  type ReadResourceResult,
} from '@frontmcp/sdk';

const reviews = fileSignal('./features.json', 'reviews', {
  defaultValue: false,
  pollIntervalMs: 1000,
  remedy: { say: 'Turn on Reviews in Settings', tool: 'settings_set' },
});

const always: EnabledSource = { get: async () => true, subscribe: () => () => undefined };

const failsOpen: EnabledSource = { get: () => true, subscribe: () => () => undefined, onError: 'on' };

// @ts-expect-error onError is 'off' or 'on'
const failsSideways: EnabledSource = { get: () => true, subscribe: () => () => undefined, onError: 'maybe' };

/** One feature map for the server, by kind, name, URI or tags. */
const features: EnabledResolver = (entry: EnabledEntryRef) => {
  if (entry.kind === 'tool' && entry.name.startsWith('review_')) return reviews;
  if (entry.uri?.startsWith('reviews://') || entry.uriTemplate?.startsWith('reviews://')) return failsOpen;
  return entry.kind === 'prompt' ? true : undefined;
};

export const unusedSources = [failsSideways];

@Tool({ name: 'review_list', inputSchema: {}, enabled: reviews })
export class ReviewListTool extends ToolContext {
  async execute() {
    return { reviews: 0 };
  }
}

@Tool({ name: 'review_count', inputSchema: {}, enabled: true })
export class ReviewCountTool extends ToolContext {
  async execute() {
    return 0;
  }
}

// @ts-expect-error enabled is a boolean or an EnabledSource
@Tool({ name: 'review_open', inputSchema: {}, enabled: 'yes' })
export class ReviewOpenTool extends ToolContext {
  async execute() {
    return 0;
  }
}

@Resource({ name: 'review-feed', uri: 'reviews://feed', enabled: always })
export class ReviewFeedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'feed' }] };
  }
}

@ResourceTemplate({ name: 'review', uriTemplate: 'reviews://{id}', enabled: false })
export class ReviewTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'review' }] };
  }
}

@Prompt({ name: 'review-summary', arguments: [], enabled: reviews })
export class ReviewSummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'summary' } }] };
  }
}

export const surfaceKey: 'frontmcp/surface' = SURFACE_META_KEY;

@App({
  name: 'Reviews',
  tools: [ReviewListTool, ReviewCountTool],
  resources: [ReviewFeedResource, ReviewTemplate],
  prompts: [ReviewSummaryPrompt],
})
export class ReviewsApp {}

@FrontMcp({ info: { name: 'reviews', version: '1.0.0' }, apps: [ReviewsApp], enabled: features })
export class ReviewsServer {}

// @ts-expect-error the server's enabled is a function of the entry
@FrontMcp({ info: { name: 'reviews-off', version: '1.0.0' }, apps: [ReviewsApp], enabled: false })
export class ReviewsOffServer {}
