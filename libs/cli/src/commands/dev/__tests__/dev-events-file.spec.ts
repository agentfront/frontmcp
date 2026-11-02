import * as os from 'os';
import * as path from 'path';

import { mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { createDevEventsWriter, startEventsFile } from '../dev-events-file';

describe('the frontmcp dev events file', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-dev-events-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts each run with an empty file, creating its folder', async () => {
    const file = path.join(dir, '.frontmcp', 'dev-events.jsonl');
    await startEventsFile(file);
    expect(await readFile(file)).toBe('');

    await writeFile(file, '{"type":"call"}\n');
    await startEventsFile(file);
    expect(await readFile(file)).toBe('');
  });

  it('appends the batches the server sends, in order, one JSON line per event', async () => {
    const file = path.join(dir, 'events.jsonl');
    const log = { warn: jest.fn() };
    const writer = createDevEventsWriter(file, log);

    writer.write([{ type: 'call', entry: 'a' }]);
    writer.write([
      { type: 'call', entry: 'b' },
      { type: 'stall', stallMs: 300 },
    ]);
    await writer.flush();

    const lines = (await readFile(file)).trimEnd().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: 'call', entry: 'a' },
      { type: 'call', entry: 'b' },
      { type: 'stall', stallMs: 300 },
    ]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs a write failure once and keeps the bridge running', async () => {
    const file = path.join(dir, 'missing-folder', 'events.jsonl');
    const log = { warn: jest.fn() };
    const writer = createDevEventsWriter(file, log);

    writer.write([{ type: 'call' }]);
    writer.write([{ type: 'call' }]);
    await writer.flush();

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('dev-events-write-failed', expect.objectContaining({ file }));
  });
});
