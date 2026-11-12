/**
 * A resource template's argument completer runs as the caller of the completion/complete request, so
 * what it suggests (the skills the caller may read, say) is decided for that caller.
 */
import 'reflect-metadata';

import { App, LogLevel, ResourceContext, ResourceTemplate } from '../../common';
import { connect } from '../../direct/connect';

@ResourceTemplate({ name: 'notes', uriTemplate: 'notes://{id}' })
class NotesTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'note' }] };
  }

  async idCompleter(_partial: string) {
    return { values: [String(this.getAuthInfo().user?.sub ?? 'nobody')] };
  }
}

@App({ id: 'desk', name: 'Desk', resources: [NotesTemplate] })
class DeskApp {}

describe('a resource argument completer', () => {
  it('sees the caller of the completion request', async () => {
    const config = {
      info: { name: 'completer-caller', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    };
    const client = await connect(config, { session: { id: 'session-ada', user: { sub: 'ada' } } });
    try {
      const result = await client.complete({
        ref: { type: 'ref/resource', uri: 'notes://{id}' },
        argument: { name: 'id', value: '' },
      });

      expect(result.completion.values).toEqual(['ada']);
    } finally {
      await client.close();
    }
  });
});
