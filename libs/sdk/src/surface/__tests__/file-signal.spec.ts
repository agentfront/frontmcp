import * as os from 'node:os';

import { mkdtemp, pathJoin, rm, writeFile } from '@frontmcp/utils';

import { InvalidFileSignalError } from '../../errors';
import { fileSignal } from '../file-signal';

let watchFails = false;

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    watchFile: (...args: Parameters<typeof actual.watchFile>) => {
      if (watchFails) throw new Error('watching is not supported here');
      return actual.watchFile(...args);
    },
  };
});

function warnings() {
  return { warn: jest.fn() };
}

async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('fileSignal', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    watchFails = false;
    dir = await mkdtemp(pathJoin(os.tmpdir(), 'file-signal-'));
    file = pathJoin(dir, 'features.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('answers the boolean the file holds under its key', async () => {
    await writeFile(file, JSON.stringify({ reviews: true, billing: false }));

    expect(await fileSignal(file, 'reviews').get()).toBe(true);
    expect(await fileSignal(file, 'billing').get()).toBe(false);
  });

  it('calls its listeners when the value changes, and answers the new value', async () => {
    await writeFile(file, JSON.stringify({ reviews: false }));
    const signal = fileSignal(file, 'reviews', { pollIntervalMs: 50 });
    const listener = jest.fn();
    const unsubscribe = signal.subscribe(listener);
    await until(() => (signal as unknown as { value?: boolean }).value === false);

    await writeFile(file, JSON.stringify({ reviews: true }));

    await until(() => listener.mock.calls.length > 0);
    expect(await signal.get()).toBe(true);
    unsubscribe();
  });

  it('does not call its listeners when the file changes but the value does not', async () => {
    await writeFile(file, JSON.stringify({ reviews: true, other: 1 }));
    const signal = fileSignal(file, 'reviews', { pollIntervalMs: 20 });
    const listener = jest.fn();
    const unsubscribe = signal.subscribe(listener);
    await until(() => (signal as unknown as { value?: boolean }).value === true);

    await writeFile(file, JSON.stringify({ reviews: true, other: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('answers its default for a missing file, and logs that once', async () => {
    const logger = warnings();
    const signal = fileSignal(file, 'reviews', { logger });

    expect(await signal.get()).toBe(false);
    expect(await signal.get()).toBe(false);
    expect(await fileSignal(file, 'reviews', { defaultValue: true, logger: warnings() }).get()).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('features.json');
  });

  it('answers its default for a file that is not JSON, or has no boolean under the key, and logs each once', async () => {
    const logger = warnings();
    const signal = fileSignal(file, 'reviews', { defaultValue: true, logger });

    await writeFile(file, '{ not json');
    expect(await signal.get()).toBe(true);
    expect(await signal.get()).toBe(true);
    await writeFile(file, JSON.stringify({ reviews: 'yes' }));
    expect(await signal.get()).toBe(true);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0][0]).toContain('not valid JSON');
    expect(logger.warn.mock.calls[1][0]).toContain('"reviews"');
  });

  it('notices a file that appears after it started', async () => {
    const signal = fileSignal(file, 'reviews', { pollIntervalMs: 50, logger: warnings() });
    const listener = jest.fn();
    const unsubscribe = signal.subscribe(listener);
    await until(() => (signal as unknown as { value?: boolean }).value === false);

    await writeFile(file, JSON.stringify({ reviews: true }));

    await until(() => listener.mock.calls.length > 0);
    expect(await signal.get()).toBe(true);
    unsubscribe();
  });

  it('polls the file when it cannot watch it', async () => {
    watchFails = true;
    await writeFile(file, JSON.stringify({ reviews: true }));
    const signal = fileSignal(file, 'reviews', { pollIntervalMs: 20 });
    const listener = jest.fn();
    const unsubscribe = signal.subscribe(listener);
    await until(() => (signal as unknown as { value?: boolean }).value === true);

    await writeFile(file, JSON.stringify({ reviews: false }));

    await until(() => listener.mock.calls.length > 0);
    expect(await signal.get()).toBe(false);
    unsubscribe();
  });

  it('stops calling a listener once it unsubscribes', async () => {
    await writeFile(file, JSON.stringify({ reviews: true }));
    const signal = fileSignal(file, 'reviews', { pollIntervalMs: 20 });
    const listener = jest.fn();
    const unsubscribe = signal.subscribe(listener);
    await until(() => (signal as unknown as { value?: boolean }).value === true);

    unsubscribe();
    await writeFile(file, JSON.stringify({ reviews: false }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(listener).not.toHaveBeenCalled();
    expect(await signal.get()).toBe(false);
  });

  it('keeps following the file after a listener throws, and reports the error', async () => {
    await writeFile(file, JSON.stringify({ reviews: true }));
    const logger = warnings();
    const signal = fileSignal(file, 'reviews', { pollIntervalMs: 20, logger });
    const listener = jest.fn();
    const unsubscribeThrowing = signal.subscribe(() => {
      throw new Error('listener failed');
    });
    const unsubscribe = signal.subscribe(listener);
    await until(() => (signal as unknown as { value?: boolean }).value === true);

    await writeFile(file, JSON.stringify({ reviews: false }));
    await until(() => listener.mock.calls.length === 1);
    await writeFile(file, JSON.stringify({ reviews: true }));
    await until(() => listener.mock.calls.length === 2);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('listener failed'));
    unsubscribeThrowing();
    unsubscribe();
  });

  it('carries the remedy it is given', () => {
    const remedy = { say: 'Turn on Reviews in Settings', tool: 'settings_set' };
    expect(fileSignal(file, 'reviews', { remedy }).remedy).toEqual(remedy);
    expect(fileSignal(file, 'reviews').remedy).toEqual({ say: 'Turn on the "reviews" feature, then try again.' });
  });

  it('refuses a key or a poll interval it cannot use', () => {
    expect(() => fileSignal(file, '')).toThrow(InvalidFileSignalError);
    expect(() => fileSignal(file, '')).toThrow('fileSignal(): it needs a key');
    expect(() => fileSignal('', 'reviews')).toThrow('fileSignal(): it needs a file path');
    expect(() => fileSignal(file, 'reviews', { pollIntervalMs: 0 })).toThrow('pollIntervalMs must be a positive');
  });
});
