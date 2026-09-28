import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import { App, LogLevel, Resource, ResourceContext } from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';

/**
 * `resources/subscribe` refuses what `resources/read` refuses, with the same error.
 *
 * It subscribed to any URI without looking it up, so a client could subscribe to (and learn the
 * change events of) a resource offered only to agents, or one unavailable in this runtime.
 */

function text(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: `content of ${uri}` }] };
}

@Resource({ name: 'open-notes', uri: 'open://notes' })
class OpenNotes extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'agent-notes', uri: 'agent://notes', availableWhen: { surface: ['agent'] } })
class AgentNotes extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'edge-notes', uri: 'edge://notes', availableWhen: { runtime: ['edge'] } })
class EdgeNotes extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@App({ id: 'notes', name: 'Notes', resources: [OpenNotes, AgentNotes, EdgeNotes] })
class NotesApp {}

/** What a caller learns from a refusal: its code and message. */
async function answerOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: string };
    return { code, message };
  }
}

describe('resources/subscribe applies what resources/read applies', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'resource-subscribe-availability', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it.each(['nothing://here', 'agent://notes', 'edge://notes'])(
    'refuses %s with the resources/read error',
    async (uri) => {
      const read = await answerOf(client.readResource(uri));
      const subscribe = await answerOf(client.subscribeResource(uri));

      expect(read).not.toBe('accepted');
      expect(subscribe).toEqual(read);
    },
  );

  it('still subscribes to a resource the caller may read', async () => {
    await expect(answerOf(client.subscribeResource('open://notes'))).resolves.toBe('accepted');
  });
});
