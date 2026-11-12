import 'reflect-metadata';

import { createTestFetchServer } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Resource,
  ResourceContext,
  type LogRecord,
} from '../../../common';
import type { Scope } from '../../../scope';

const records: LogRecord[] = [];

@LogTransport({ name: 'RecordingTransport', description: 'Keeps every record for the test' })
class RecordingTransport extends LogTransportInterface {
  log(rec: LogRecord): void {
    records.push(rec);
  }
}

@Resource({ name: 'readme', uri: 'docs://readme', mimeType: 'text/plain' })
class ReadmeResource extends ResourceContext {
  async execute() {
    return 'read me';
  }
}

@App({ id: 'docs', name: 'Docs', resources: [ReadmeResource] })
class DocsApp {}

describe('resources/read logs the requested URI on one line', () => {
  let scope: Scope;

  beforeAll(async () => {
    const server = await createTestFetchServer({
      info: { name: 'log-uri', version: '1.0.0' },
      apps: [DocsApp],
      logging: { level: LogLevel.Verbose, enableConsole: false, transports: [RecordingTransport] },
    });
    scope = server.instance.getScopes()[0] as Scope;
  });

  beforeEach(() => {
    records.length = 0;
  });

  it('a URI with a line break does not put a raw line break into the not-found warning', async () => {
    const uri = 'docs://missing\n[12:00:00.000] ERROR forged';
    await expect(
      scope.runFlow('resources:read-resource', { request: { method: 'resources/read', params: { uri } }, ctx: {} }),
    ).rejects.toThrow();

    const warning = records.find((rec) => rec.level === LogLevel.Warn && rec.message.includes('not found'));
    expect(warning?.message).toBe(
      'findResource: resource for URI "docs://missing\\n[12:00:00.000] ERROR forged" not found',
    );
    expect(records.some((rec) => /[\r\n]/.test(rec.message) || /[\r\n]/.test(rec.prefix ?? ''))).toBe(false);
  });
});
