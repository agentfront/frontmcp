/**
 * The flow a hook receives exposes what hooks used to dig out of its state or reach through protected
 * members: the tool's name and input, the resource's URI, the prompt's name, the request it serves,
 * list_changed notifications and the run's first failure.
 */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import { FlowBase, type FlowCtxOf, type FlowMetadata, type ScopeEntry } from '../../common';
import { FrontMcpContextStorage } from '../../context/frontmcp-context-storage';
import { type DirectClient } from '../../direct/client.types';
import { type DirectMcpServer } from '../../direct/direct.types';
import { PublicMcpError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  LogLevel,
  Plugin,
  Prompt,
  PromptContext,
  PromptHook,
  Resource,
  ResourceContext,
  ResourceHook,
  Tool,
  ToolContext,
  ToolHook,
} from '../../index';

const seen: Array<Record<string, unknown>> = [];

@Plugin({ name: 'accessor-probe' })
class AccessorProbe {
  @ToolHook.Will('parseInput')
  beforeParse(ctx: FlowCtxOf<'tools:call-tool'>) {
    seen.push({ at: 'will:parseInput', toolName: ctx.toolName, toolInput: ctx.toolInput });
  }

  @ToolHook.Will('findTool')
  beforeFind(ctx: FlowCtxOf<'tools:call-tool'>) {
    seen.push({ at: 'will:findTool', toolName: ctx.toolName });
  }

  @ToolHook.Did('findTool')
  afterFind(ctx: FlowCtxOf<'tools:call-tool'>) {
    seen.push({ at: 'did:findTool', toolName: ctx.toolName });
  }

  @ToolHook.Will('execute')
  beforeExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
    seen.push({ at: 'will:execute', toolInput: ctx.toolInput, request: ctx.request });
    if (ctx.toolInput?.['announce'] === true) ctx.notify.listChanged('tools');
  }

  @ToolHook.Finally('execute')
  afterExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
    seen.push({ at: 'finally:execute', error: ctx.error });
  }

  @ResourceHook.Will('parseInput')
  beforeParseRead(ctx: FlowCtxOf<'resources:read-resource'>) {
    seen.push({ at: 'will:parseRead', uri: ctx.uri });
  }

  @ResourceHook.Will('execute')
  beforeRead(ctx: FlowCtxOf<'resources:read-resource'>) {
    seen.push({ at: 'will:read', uri: ctx.uri });
  }

  @PromptHook.Will('parseInput')
  beforeParsePrompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    seen.push({ at: 'will:parsePrompt', promptName: ctx.promptName });
  }

  @PromptHook.Will('findPrompt')
  beforeFindPrompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    seen.push({ at: 'will:findPrompt', promptName: ctx.promptName });
  }

  @PromptHook.Did('findPrompt')
  afterFindPrompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    seen.push({ at: 'did:findPrompt', promptName: ctx.promptName });
  }
}

@Tool({ name: 'say_hello', inputSchema: {} })
class SayHelloTool extends ToolContext {
  async execute() {
    return 'hello';
  }
}

@Tool({ id: 'archive_note', name: 'Archive a note', inputSchema: {} })
class ArchiveNoteTool extends ToolContext {
  async execute() {
    return 'archived';
  }
}

@Tool({ name: 'ledger', inputSchema: {} })
class LedgerTool extends ToolContext {
  async execute(): Promise<string> {
    throw new PublicMcpError('The ledger is unreachable');
  }
}

@Resource({ name: 'readme', uri: 'notes://readme', mimeType: 'text/plain' })
class ReadmeResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'read me' }] };
  }
}

@Prompt({ name: 'greeting', arguments: [] })
class GreetingPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] };
  }
}

@App({
  id: 'notes',
  name: 'Notes',
  plugins: [AccessorProbe],
  tools: [SayHelloTool, ArchiveNoteTool, LedgerTool],
  resources: [ReadmeResource],
  prompts: [GreetingPrompt],
})
class NotesApp {}

const at = (stage: string) => seen.find((entry) => entry['at'] === stage);

describe('flow accessors in hooks', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'flow-accessors', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    seen.length = 0;
  });

  it('toolName is the name the call asks for until findTool resolves the tool, then the name the tool declares', async () => {
    await server.callTool('notes:say_hello', { mood: 'cheerful' });

    expect(at('will:parseInput')).toEqual({
      at: 'will:parseInput',
      toolName: 'notes:say_hello',
      toolInput: { mood: 'cheerful' },
    });
    expect(at('will:findTool')).toEqual({ at: 'will:findTool', toolName: 'notes:say_hello' });
    expect(at('did:findTool')).toEqual({ at: 'did:findTool', toolName: 'say_hello' });
  });

  it('toolName of a tool with an id stays the name tools/list lists it under', async () => {
    await server.callTool('archive_note', {});

    expect(at('will:findTool')).toEqual({ at: 'will:findTool', toolName: 'archive_note' });
    expect(at('did:findTool')).toEqual({ at: 'did:findTool', toolName: 'archive_note' });
  });

  it('toolInput is the arguments the call passes to the tool', async () => {
    await server.callTool('say_hello', { mood: 'calm' });

    expect(at('will:execute')?.['toolInput']).toEqual({ mood: 'calm' });
  });

  it('request carries the metadata of an in-process call', async () => {
    await server.callTool('say_hello', {}, { metadata: { userAgent: 'probe-agent/1.0' } });

    expect(at('will:execute')?.['request']).toMatchObject({
      metadata: { userAgent: 'probe-agent/1.0' },
      protocol: undefined,
    });
  });

  it('error is undefined after a stage that succeeded, and the first failure of the run after one that failed', async () => {
    await server.callTool('say_hello', {});
    expect(at('finally:execute')).toEqual({ at: 'finally:execute', error: undefined });

    seen.length = 0;
    await expect(server.callTool('ledger', {})).rejects.toThrow('The ledger is unreachable');
    const error = at('finally:execute')?.['error'];
    expect(error).toBeInstanceOf(PublicMcpError);
    expect((error as Error).message).toBe('The ledger is unreachable');
  });

  it('uri is the URI a read asks for, before and after parseInput', async () => {
    await server.readResource('notes://readme');

    expect(at('will:parseRead')).toEqual({ at: 'will:parseRead', uri: 'notes://readme' });
    expect(at('will:read')).toEqual({ at: 'will:read', uri: 'notes://readme' });
  });

  it('promptName is the name the request asks for until findPrompt resolves the prompt', async () => {
    await server.getPrompt('greeting', {});

    expect(at('will:parsePrompt')).toEqual({ at: 'will:parsePrompt', promptName: 'greeting' });
    expect(at('will:findPrompt')).toEqual({ at: 'will:findPrompt', promptName: 'greeting' });
    expect(at('did:findPrompt')).toEqual({ at: 'did:findPrompt', promptName: 'greeting' });
  });

  describe('over a connected session', () => {
    let client: DirectClient;
    const notifications: string[] = [];

    beforeEach(async () => {
      notifications.length = 0;
      client = await server.connect({ clientInfo: { name: 'probe-client', version: '3.1.0' } });
      client.onNotification((notification) => notifications.push(notification.method));
    });

    afterEach(async () => {
      await client.close();
    });

    it('request names the session and the client its initialize reported', async () => {
      await client.callTool('say_hello', {});

      const request = at('will:execute')?.['request'] as FlowCtxOf<'tools:call-tool'>['request'];
      expect(request.sessionId).toEqual(expect.any(String));
      expect(request.clientInfo).toEqual({ name: 'probe-client', version: '3.1.0' });
    });

    it('notify.listChanged() sends notifications/tools/list_changed to the client', async () => {
      await client.callTool('say_hello', { announce: true });
      for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0));

      expect(notifications).toContain('notifications/tools/list_changed');
    });
  });
});

describe('flow accessors outside a request', () => {
  class BareFlow extends FlowBase<'tools:list-tools'> {}

  const broadcastNotification = jest.fn();
  const getClientInfo = jest.fn();
  const storage = new FrontMcpContextStorage();

  function bareFlow(getProvider: () => unknown = () => storage): BareFlow {
    const scope = {
      logger: { child: () => scope.logger },
      providers: { get: getProvider },
      notifications: { broadcastNotification, getClientInfo },
    } as unknown as ScopeEntry;
    return new BareFlow({ name: 'tools:list-tools' } as FlowMetadata<'tools:list-tools'>, {}, scope, () => undefined);
  }

  beforeEach(() => {
    broadcastNotification.mockReset();
    getClientInfo.mockReset();
  });

  it('request has undefined fields, and never throws, without a request context', () => {
    const noRequest = { sessionId: undefined, clientInfo: undefined, metadata: undefined, protocol: undefined };

    expect(bareFlow().request).toEqual(noRequest);
    expect(
      bareFlow(() => {
        throw new Error('no context storage');
      }).request,
    ).toEqual(noRequest);
    expect(getClientInfo).not.toHaveBeenCalled();
  });

  it('request reads the context it runs in, and the client info of the session when the request has none', async () => {
    getClientInfo.mockReturnValue({ name: 'session-client', version: '1.0.0' });
    const flow = bareFlow();

    const request = await storage.run(
      { sessionId: 'session-1', scopeId: 'scope', authInfo: { sessionId: 'session-1' } },
      () => {
        storage.getStoreOrThrow().updateSessionMetadata({
          nodeId: 'node',
          authSig: 'sig',
          uuid: '00000000-0000-4000-8000-000000000000',
          iat: 0,
          protocol: 'streamable-http',
        });
        return flow.request;
      },
    );

    expect(request).toEqual({
      sessionId: 'session-1',
      clientInfo: { name: 'session-client', version: '1.0.0' },
      metadata: { customHeaders: {} },
      protocol: 'streamable-http',
    });
    expect(getClientInfo).toHaveBeenCalledWith('session-1');
  });

  it('request prefers the client info the request itself carries', async () => {
    const flow = bareFlow();

    const request = await storage.run({ sessionId: 'session-2', scopeId: 'scope' }, () => {
      storage.getStoreOrThrow().setClientInfo({ name: 'request-client', version: '2.0.0' }, 'unknown');
      return flow.request;
    });

    expect(request.sessionId).toBeUndefined();
    expect(request.clientInfo).toEqual({ name: 'request-client', version: '2.0.0' });
    expect(getClientInfo).not.toHaveBeenCalled();
  });

  it.each(['tools', 'resources', 'prompts'] as const)('notify.listChanged(%s) broadcasts its list_changed', (kind) => {
    bareFlow().notify.listChanged(kind);

    expect(broadcastNotification).toHaveBeenCalledWith(`notifications/${kind}/list_changed`);
  });

  it.each(['request', 'notify', 'error'] as const)(
    'a flow that assigns its own %s keeps that value instead of throwing',
    (accessor) => {
      const flow = bareFlow();
      const ownValue = { set: 'by the flow' };

      expect(Reflect.set(flow, accessor, ownValue)).toBe(true);
      expect(Reflect.get(flow, accessor)).toBe(ownValue);
      expect(Reflect.get(bareFlow(), accessor)).not.toBe(ownValue);
    },
  );

  it('error is state.flowError', () => {
    const flow = bareFlow();
    expect(flow.error).toBeUndefined();

    const failure = new Error('stage failed');
    flow.state.set('flowError' as never, failure as never);

    expect(flow.error).toBe(failure);
  });
});
