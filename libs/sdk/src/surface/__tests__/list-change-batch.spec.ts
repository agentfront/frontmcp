import 'reflect-metadata';

import { Client } from '@frontmcp/protocol/client';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import type { RuntimeToolDefinition } from '../../direct/direct.types';
import { registerRuntimeTool } from '../../direct/runtime-tools';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createInMemoryServer } from '../../transport/in-memory-server';
import { announcesListChangeNow, runListChangeBatch, type BatchedListKind } from '../list-change-batch';
import { keepingListsUnchanged } from '../unchanged-lists';

/**
 * A scope's lists, and a client of them that is sent one notification for each registry change announced now. A
 * registry's `notifyListChanged()` reaches the client as a change, as the real registries' change events do.
 */
function testLists(name = 'lists') {
  const sent: string[] = [];
  const change = (kind: BatchedListKind): void => {
    if (announcesListChangeNow(lists, kind)) sent.push(`${name}:${kind}`);
  };
  const registryOf = (kind: BatchedListKind) => ({ notifyListChanged: () => change(kind) });
  const lists = {
    tools: registryOf('tools'),
    resources: registryOf('resources'),
    prompts: registryOf('prompts'),
    skills: registryOf('skills'),
  };
  return { lists, sent, change };
}

describe('runListChangeBatch', () => {
  it('announces a change made outside a batch at once', () => {
    const { sent, change } = testLists();

    change('tools');
    change('tools');

    expect(sent).toEqual(['lists:tools', 'lists:tools']);
  });

  it('announces each list a batch changed once, when it ends, and none it left alone', async () => {
    const { lists, sent, change } = testLists();
    let sentInside: string[] = [];

    const result = await runListChangeBatch(lists, async () => {
      change('tools');
      change('resources');
      await Promise.resolve();
      change('tools');
      change('skills');
      sentInside = [...sent];
      return 'applied';
    });

    expect(result).toBe('applied');
    expect(sentInside).toEqual([]);
    expect(sent).toEqual(['lists:tools', 'lists:resources', 'lists:skills']);
  });

  it('announces nothing for a batch that changes nothing', async () => {
    const { lists, sent } = testLists();

    await expect(runListChangeBatch(lists, () => 42)).resolves.toBe(42);

    expect(sent).toEqual([]);
  });

  it('joins a batch run inside another: what both changed is announced once, when the outer one ends', async () => {
    const { lists, sent, change } = testLists();
    let sentAfterInner: string[] = [];

    await runListChangeBatch(lists, async () => {
      change('tools');
      await runListChangeBatch(lists, async () => {
        change('tools');
        change('prompts');
      });
      sentAfterInner = [...sent];
    });

    expect(sentAfterInner).toEqual([]);
    expect(sent).toEqual(['lists:tools', 'lists:prompts']);
  });

  it('announces what changed before a throw once, and rejects with the error', async () => {
    const { lists, sent, change } = testLists();

    const batch = runListChangeBatch(lists, async () => {
      change('skills');
      change('skills');
      throw new Error('rolled back');
    });

    await expect(batch).rejects.toThrow('rolled back');
    expect(sent).toEqual(['lists:skills']);
  });

  it('announces a change made by other code while a batch runs at once', async () => {
    const { lists, sent, change } = testLists();
    let finish = (): void => undefined;

    const running = runListChangeBatch(lists, async () => {
      change('tools');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    change('prompts');
    const sentWhileRunning = [...sent];
    finish();
    await running;

    expect(sentWhileRunning).toEqual(['lists:prompts']);
    expect(sent).toEqual(['lists:prompts', 'lists:tools']);
  });

  it('announces at once a change that code a batch started makes after the batch ended', async () => {
    const { lists, sent, change } = testLists();
    let later = (): void => undefined;
    const startedLater = new Promise<void>((resolve) => {
      later = resolve;
    });
    let changedLater: Promise<void> = Promise.resolve();

    await runListChangeBatch(lists, () => {
      changedLater = startedLater.then(() => change('resources'));
    });
    later();
    await changedLater;

    expect(sent).toEqual(['lists:resources']);
  });

  it('does not announce a change that leaves the lists as clients see them', async () => {
    const { lists, sent, change } = testLists();

    await runListChangeBatch(lists, () => keepingListsUnchanged(() => change('tools')));
    keepingListsUnchanged(() => change('tools'));

    expect(sent).toEqual([]);
  });

  it("holds only its own scope's lists, also inside a batch of another scope", async () => {
    const billing = testLists('billing');
    const shipping = testLists('shipping');
    let sentAfterInner: string[] = [];

    await runListChangeBatch(billing.lists, async () => {
      shipping.change('tools');
      await runListChangeBatch(shipping.lists, async () => {
        billing.change('prompts');
        shipping.change('resources');
      });
      sentAfterInner = [...billing.sent, ...shipping.sent];
    });

    expect(sentAfterInner).toEqual(['shipping:tools', 'shipping:resources']);
    expect(billing.sent).toEqual(['billing:prompts']);
  });
});

@Tool({ name: 'search_tickets', inputSchema: {} })
class SearchTickets extends ToolContext {
  async execute() {
    return 'none';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [SearchTickets] })
class DeskApp {}

function runtimeTool(name: string): RuntimeToolDefinition {
  return {
    name,
    description: `The ${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => ({ content: [{ type: 'text' as const, text: name }] }),
  };
}

describe('scope.batchListChanges() on a server with a connected client', () => {
  let scope: Scope;
  let client: Client;
  let closeServer: () => Promise<void>;
  const notifications: string[] = [];

  async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function sentSince(seen: number): string[] {
    return notifications.slice(seen).filter((method) => method.endsWith('/list_changed'));
  }

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'help-desk', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    scope = instance.getScopes()[0] as Scope;
    const server = await createInMemoryServer(scope);
    closeServer = server.close;
    client = new Client({ name: 'list-change-counter', version: '1.0.0' });
    client.fallbackNotificationHandler = async ({ method }) => {
      notifications.push(method);
    };
    await client.connect(server.clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await closeServer?.();
    await scope?.dispose();
  });

  it('sends one tools/list_changed for tools registered and removed in one batch', async () => {
    const seen = notifications.length;

    const unregisters = await scope.batchListChanges(async () => {
      const added = [
        await registerRuntimeTool(scope, runtimeTool('open_ticket')),
        await registerRuntimeTool(scope, runtimeTool('close_ticket')),
        await registerRuntimeTool(scope, runtimeTool('assign_ticket')),
      ];
      added[2]();
      return added.slice(0, 2);
    });
    await settle();
    const sentByBatch = sentSince(seen);
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    await scope.batchListChanges(() => {
      for (const unregister of unregisters) unregister();
    });
    await settle();

    expect(sentByBatch).toEqual(['notifications/tools/list_changed']);
    expect(listed).toEqual(expect.arrayContaining(['open_ticket', 'close_ticket']));
    expect(listed).not.toContain('assign_ticket');
    expect(sentSince(seen)).toEqual(['notifications/tools/list_changed', 'notifications/tools/list_changed']);
  });

  it('sends a change made outside a batch as it happens', async () => {
    const seen = notifications.length;

    const unregister = await registerRuntimeTool(scope, runtimeTool('escalate_ticket'));
    await settle();
    const sentByRegister = sentSince(seen);
    unregister();
    await settle();

    expect(sentByRegister).toEqual(['notifications/tools/list_changed']);
    expect(sentSince(seen)).toEqual(['notifications/tools/list_changed', 'notifications/tools/list_changed']);
  });
});
