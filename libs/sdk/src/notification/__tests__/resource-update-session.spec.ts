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

const draftsBinding: EnabledSource = {
  get: (context) => (context?.platformEnv as { DRAFTS_ON?: boolean } | undefined)?.DRAFTS_ON === true,
  subscribe: () => () => undefined,
};

@Resource({ name: 'desk-drafts', uri: 'desk://drafts', enabled: draftsBinding })
class DeskDraftsResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'drafts' }] };
  }
}

@Tool({ name: 'touch_notes', inputSchema: {} })
class TouchNotesTool extends ToolContext {
  async execute() {
    this.notifyResourceUpdated('desk://notes');
    return 'touched';
  }
}

@Tool({ name: 'touch_drafts', inputSchema: {} })
class TouchDraftsTool extends ToolContext {
  async execute() {
    this.notifyResourceUpdated('desk://drafts');
    return 'touched';
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  resources: [DeskNotesResource, DeskDraftsResource],
  tools: [TouchNotesTool, TouchDraftsTool],
})
class DeskApp {}

const deskConfig = { info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], logging: { level: LogLevel.Off } };

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("an update's access check runs as the subscribed session", () => {
  let client: DirectClient;
  let updated: string[];

  beforeEach(async () => {
    client = await connect(deskConfig);
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

describe("an update's access check runs with the subscriber's platform bindings", () => {
  it('tells a client whose workerEnv turns the resource on of its updates', async () => {
    const client = await connect(deskConfig, { workerEnv: { DRAFTS_ON: true } });
    try {
      const updated: string[] = [];
      client.onResourceUpdated((uri) => updated.push(uri));
      await client.subscribeResource('desk://drafts');

      await client.callTool('touch_drafts', {});
      await settle();

      expect(updated).toEqual(['desk://drafts']);
    } finally {
      await client.close();
    }
  });
});
