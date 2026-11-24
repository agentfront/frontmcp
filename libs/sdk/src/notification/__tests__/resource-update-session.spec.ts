import 'reflect-metadata';

import { App, LogLevel, Resource, ResourceContext, Tool, ToolContext, type EnabledSource } from '../../common';
import type { DirectClient } from '../../direct/client.types';
import { connect } from '../../direct/connect';

const gate = { session: undefined as string | undefined, unsubscribeOnCheck: undefined as DirectClient | undefined };

const sessionGate: EnabledSource = {
  async get(context) {
    const unsubscribing = gate.unsubscribeOnCheck;
    gate.unsubscribeOnCheck = undefined;
    if (unsubscribing) await unsubscribing.unsubscribeResource('desk://notes');
    return context?.sessionId !== undefined && context.sessionId === gate.session;
  },
  subscribe: () => () => undefined,
};

@Resource({ name: 'desk-notes', uri: 'desk://notes', enabled: sessionGate })
class DeskNotesResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'notes' }] };
  }
}

@Tool({ name: 'touch_notes', inputSchema: {} })
class TouchNotesTool extends ToolContext {
  async execute() {
    this.notifyResourceUpdated('desk://notes');
    return 'touched';
  }
}

@App({ id: 'desk', name: 'Desk', resources: [DeskNotesResource], tools: [TouchNotesTool] })
class DeskApp {}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("an update's access check runs as the subscribed session", () => {
  let client: DirectClient;
  let updated: string[];

  beforeEach(async () => {
    client = await connect({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    gate.session = client.getSessionId();
    updated = [];
    client.onResourceUpdated((uri) => updated.push(uri));
    await client.subscribeResource('desk://notes');
  });

  afterEach(async () => {
    await client.close();
  });

  it("answers a resource's enabled for that session, not for an anonymous request", async () => {
    await client.callTool('touch_notes', {});
    await settle();

    expect(updated).toEqual(['desk://notes']);
  });

  it('subscribes nothing: a session that unsubscribed while the check ran is told nothing', async () => {
    gate.unsubscribeOnCheck = client;

    await client.callTool('touch_notes', {});
    await settle();
    await client.callTool('touch_notes', {});
    await settle();

    expect(updated).toEqual([]);
  });
});
