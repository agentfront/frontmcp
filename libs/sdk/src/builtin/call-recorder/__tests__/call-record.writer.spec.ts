import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FrontMcpLogger } from '../../../common';
import { CallRecordWriter } from '../call-record.writer';

let openDisk: () => void = () => undefined;
let diskOpen = Promise.resolve();

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      await diskOpen;
      return actual.appendFile(...args);
    },
  };
});

function loggerCapturing(warnings: string[]): FrontMcpLogger {
  return { warn: (message: string) => warnings.push(message) } as unknown as FrontMcpLogger;
}

describe('CallRecordWriter', () => {
  it('drops lines while maxBytes of lines wait for a slow disk, logs that once, and writes the rest in order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-record-writer-'));
    const file = path.join(dir, 'calls.jsonl');
    const warnings: string[] = [];
    diskOpen = new Promise<void>((resolve) => (openDisk = resolve));
    const writer = new CallRecordWriter({ path: file, maxBytes: 20 }, loggerCapturing(warnings));
    try {
      for (const line of ['one-----\n', 'two-----\n', 'three---\n', 'four----\n']) writer.write(line);
      openDisk();
      await writer.onShutdown();

      expect(fs.readFileSync(file, 'utf8')).toBe('one-----\ntwo-----\n');
      expect(warnings).toEqual([expect.stringMatching(/^Dropped a call: 18 bytes of calls are still waiting/)]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
