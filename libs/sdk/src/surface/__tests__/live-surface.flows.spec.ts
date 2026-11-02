/**
 * `enabled` on tools, resources, resource templates and prompts, through the list, call, read, get and
 * completion flows of a connected client: lists filtered live, FEATURE_OFF refusals with a remedy, coalesced
 * list_changed, the surface hash and STALE_TOOL_LIST.
 */
import 'reflect-metadata';

import type { CallToolResult } from '@frontmcp/protocol';

import {
  App,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type EnabledSource,
  type GetPromptResult,
  type ReadResourceResult,
} from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { SURFACE_META_KEY, surfaceHash } from '../index';

class Switch implements EnabledSource {
  readonly remedy?: { say: string; tool?: string };
  private readonly listeners = new Set<() => void>();
  on = true;

  constructor(remedy?: { say: string; tool?: string }) {
    this.remedy = remedy;
  }

  get(): boolean {
    return this.on;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(on: boolean): void {
    this.on = on;
    for (const listener of [...this.listeners]) listener();
  }
}

const reviews = new Switch({ say: 'Turn on Reviews in Settings', tool: 'settings_set' });
const broken: EnabledSource = {
  get: () => {
    throw new Error('the flag service is down');
  },
  subscribe: () => () => undefined,
};

const text = (uri: string): ReadResourceResult => ({ contents: [{ uri, text: `content of ${uri}` }] });
const message = (value: string): GetPromptResult => ({
  messages: [{ role: 'user', content: { type: 'text', text: value } }],
});

@Tool({ name: 'always_on', inputSchema: {} })
class AlwaysOnTool extends ToolContext {
  async execute() {
    return { ran: 'always_on' };
  }
}

@Tool({ name: 'off_tool', aliases: ['legacy.off'], inputSchema: {}, enabled: false })
class OffTool extends ToolContext {
  async execute() {
    return { ran: 'off_tool' };
  }
}

@Tool({ name: 'review_list', inputSchema: {}, enabled: reviews })
class ReviewListTool extends ToolContext {
  async execute() {
    return { ran: 'review_list' };
  }
}

@Tool({ name: 'broken_tool', inputSchema: {}, enabled: broken })
class BrokenTool extends ToolContext {
  async execute() {
    return { ran: 'broken_tool' };
  }
}

@Tool({ name: 'calls_off_tool', inputSchema: {} })
class CallsOffTool extends ToolContext {
  async execute() {
    try {
      await this.callTool('off_tool', {});
      return { refusedWith: 'nothing' };
    } catch (error) {
      return { refusedWith: (error as { code?: string }).code };
    }
  }
}

@Resource({ name: 'on-resource', uri: 'live://on' })
class OnResource extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'off-resource', uri: 'live://off', enabled: false })
class OffResource extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'review-feed', uri: 'live://reviews', enabled: reviews })
class ReviewFeedResource extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@ResourceTemplate({ name: 'off-template', uriTemplate: 'live://off-report/{reportId}', enabled: false })
class OffTemplate extends ResourceContext<{ reportId: string }> {
  async execute(uri: string) {
    return text(uri);
  }
}

@ResourceTemplate({ name: 'on-template', uriTemplate: 'live://on-report/{reportId}' })
class OnTemplate extends ResourceContext<{ reportId: string }> {
  async execute(uri: string) {
    return text(uri);
  }
}

@Prompt({ name: 'on-prompt', arguments: [] })
class OnPrompt extends PromptContext {
  async execute() {
    return message('on');
  }
}

@Prompt({ name: 'off-prompt', arguments: [{ name: 'topic' }], enabled: false })
class OffPrompt extends PromptContext {
  async topicCompleter() {
    return { values: ['leaked'] };
  }

  async execute() {
    return message('off');
  }
}

@App({
  id: 'live',
  name: 'Live',
  tools: [AlwaysOnTool, OffTool, ReviewListTool, BrokenTool, CallsOffTool],
  resources: [OnResource, OffResource, ReviewFeedResource, OffTemplate, OnTemplate],
  prompts: [OnPrompt, OffPrompt],
})
class LiveApp {}

const serverConfig = {
  info: { name: 'live-surface', version: '1.0.0' },
  apps: [LiveApp],
  logging: { level: LogLevel.Off },
};

const toolNames = async (client: DirectClient) =>
  ((await client.listTools()) as Array<{ name: string }>).map((tool) => tool.name);

const refusalOf = (pending: Promise<unknown>) =>
  pending.then(
    () => undefined,
    (error: unknown) => error as { message?: string; data?: Record<string, unknown> },
  );

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a live surface through the flows', () => {
  let client: DirectClient;
  const notifications: string[] = [];

  beforeAll(async () => {
    client = await connect(serverConfig);
    client.onNotification(({ method }) => notifications.push(method));
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    reviews.set(true);
    notifications.length = 0;
  });

  describe('lists', () => {
    it('leave out what is off', async () => {
      const tools = await toolNames(client);
      expect(tools).toEqual(expect.arrayContaining(['always_on', 'review_list']));
      expect(tools).not.toContain('off_tool');

      const { resources } = await client.listResources();
      expect(resources.map((resource) => resource.uri)).toEqual(['live://on', 'live://reviews']);

      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.map((template) => template.name)).toEqual(['on-template']);

      const { prompts } = await client.listPrompts();
      expect(prompts.map((prompt) => prompt.name)).toEqual(['on-prompt']);
    });

    it('leave out an entry whose source fails to answer', async () => {
      expect(await toolNames(client)).not.toContain('broken_tool');
    });

    it('follow a source as it changes', async () => {
      reviews.set(false);
      expect(await toolNames(client)).not.toContain('review_list');
      expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual(['live://on']);

      reviews.set(true);
      expect(await toolNames(client)).toContain('review_list');
    });
  });

  describe('refusals', () => {
    it('refuse a call to a tool that is off with FEATURE_OFF and a remedy, by its name or an alias', async () => {
      for (const name of ['off_tool', 'legacy.off']) {
        const result = (await client.callTool(name, {})) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(result._meta).toMatchObject({
          code: 'FEATURE_OFF',
          remedy: { say: `Ask the server's operator to turn on tool "off_tool".` },
        });
        expect(JSON.stringify(result)).not.toContain('"ran"');
      }
    });

    it("refuse with the remedy of the tool's source", async () => {
      reviews.set(false);
      const result = (await client.callTool('review_list', {})) as CallToolResult;

      expect(result._meta).toMatchObject({ code: 'FEATURE_OFF', remedy: reviews.remedy });
      expect((result.content[0] as { text: string }).text).toBe(
        'Tool "review_list" is turned off\nTo fix: Turn on Reviews in Settings (call settings_set)',
      );
    });

    it('refuse a tool that is off to this.callTool() as well', async () => {
      const result = (await client.callTool('calls_off_tool', {})) as CallToolResult;
      expect(result.structuredContent).toEqual({ refusedWith: 'FEATURE_OFF' });
    });

    it('refuse a read of a resource or a template URI that is off, with status 403 in data', async () => {
      for (const [uri, entryType] of [
        ['live://off', 'Resource'],
        ['live://off-report/7', 'ResourceTemplate'],
      ]) {
        const refusal = await refusalOf(client.readResource(uri));

        expect(refusal?.data).toMatchObject({
          code: 'FEATURE_OFF',
          status: 403,
          entryType,
          remedy: expect.any(Object),
        });
      }
    });

    it('refuse a get of a prompt that is off', async () => {
      const refusal = await refusalOf(client.getPrompt('off-prompt'));
      expect(refusal?.data).toMatchObject({
        code: 'FEATURE_OFF',
        status: 403,
        entryType: 'Prompt',
        entry: 'off-prompt',
      });
    });

    it('complete nothing for a prompt that is off', async () => {
      const result = await client.complete({
        ref: { type: 'ref/prompt', name: 'off-prompt' },
        argument: { name: 'topic', value: '' },
      });
      expect(result.completion.values).toEqual([]);
    });

    it('serve what is on', async () => {
      expect(((await client.callTool('always_on', {})) as CallToolResult).isError).not.toBe(true);
      expect((await client.readResource('live://on-report/1')).contents[0]).toMatchObject({
        uri: 'live://on-report/1',
      });
      expect((await client.getPrompt('on-prompt')).messages).toHaveLength(1);
    });
  });

  describe('list_changed', () => {
    it('is sent once per kind when a source changes, however often it changes in the window', async () => {
      reviews.set(false);
      reviews.set(true);
      reviews.set(false);
      await pause(250);

      expect(notifications.filter((method) => method === 'notifications/tools/list_changed')).toHaveLength(1);
      expect(notifications.filter((method) => method === 'notifications/resources/list_changed')).toHaveLength(1);
      expect(notifications).not.toContain('notifications/prompts/list_changed');
    });
  });

  describe('a stale tool list', () => {
    it('answers STALE_TOOL_LIST and sends list_changed to a session calling a tool its old list showed', async () => {
      expect(await toolNames(client)).toContain('review_list');
      reviews.set(false);
      await pause(250);
      notifications.length = 0;

      const stale = (await client.callTool('review_list', {})) as CallToolResult;
      expect(stale.isError).toBe(true);
      expect(stale._meta).toMatchObject({
        code: 'STALE_TOOL_LIST',
        remedy: { say: 'Call tools/list again, then call a tool from the new list.' },
      });
      await pause(20);
      expect(notifications).toContain('notifications/tools/list_changed');

      const refused = (await client.callTool('review_list', {})) as CallToolResult;
      expect(refused._meta).toMatchObject({ code: 'FEATURE_OFF' });
    });

    it('answers a call to a tool the session never had as not found', async () => {
      await toolNames(client);
      reviews.set(false);
      await pause(250);

      const stale = (await client.callTool('no_such_tool', {})) as CallToolResult;
      expect(stale._meta).toMatchObject({ code: 'STALE_TOOL_LIST' });
      const missing = (await client.callTool('no_such_tool', {})) as CallToolResult;
      expect(missing._meta).toMatchObject({ code: 'TOOL_NOT_FOUND' });
    });

    it('lets a stale session call a tool that is still on', async () => {
      await toolNames(client);
      reviews.set(false);
      await pause(250);

      const result = (await client.callTool('always_on', {})) as CallToolResult;
      expect(result.isError).not.toBe(true);
    });
  });

  describe('the surface hash', () => {
    const ctx = { authInfo: { sessionId: 'session-hash' } };

    it("is carried by tools/list for every tool name the session was shown, and kept as the session's", async () => {
      const [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes();
      const listing = await scope.runFlowForOutput('tools:list-tools', {
        request: { method: 'tools/list', params: {} },
        ctx,
      });

      expect(listing._meta?.[SURFACE_META_KEY]).toBe(surfaceHash(listing.tools.map((tool) => tool.name)));
      expect(scope.surface?.isStale('session-hash')).toBe(false);
      scope.tools.notifyListChanged();
      expect(scope.surface?.isStale('session-hash')).toBe(true);
    });

    it('is carried by the resource, template and prompt lists', async () => {
      const [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes();
      const resources = await scope.runFlowForOutput('resources:list-resources', {
        request: { method: 'resources/list', params: {} },
        ctx,
      });
      const templates = await scope.runFlowForOutput('resources:list-resource-templates', {
        request: { method: 'resources/templates/list', params: {} },
        ctx,
      });
      const prompts = await scope.runFlowForOutput('prompts:list-prompts', {
        request: { method: 'prompts/list', params: {} },
        ctx,
      });

      expect(resources._meta?.[SURFACE_META_KEY]).toBe(surfaceHash(['live://on', 'live://reviews']));
      expect(templates._meta?.[SURFACE_META_KEY]).toBe(surfaceHash(['live://on-report/{reportId}']));
      expect(prompts._meta?.[SURFACE_META_KEY]).toBe(surfaceHash(['on-prompt']));
    });
  });

  describe('validation', () => {
    it('refuses an enabled that is neither a boolean nor a source, naming the option', () => {
      expect(() =>
        Tool({ name: 'bad_enabled', inputSchema: {}, enabled: 'yes' as unknown as boolean })(class BadTool {}),
      ).toThrow('`enabled` must be a boolean or an EnabledSource');
    });
  });
});
