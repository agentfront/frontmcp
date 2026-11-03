import * as path from 'node:path';

import { InvalidSharedServerOptionsError } from '../../errors';
import { parseSharedServerOptions } from '../shared-server.options';

const KEY_FORMAT =
  'key: key must be 1 to 64 lowercase letters, digits, ".", "_" or "-", starting and ending with a letter or digit';
const ATTACH_BUDGET = 'attachBudgetMs: attachBudgetMs must be a whole number of milliseconds from 1 to 600000';
const IDLE_TIMEOUT =
  'idleTimeoutMs: idleTimeoutMs must be a whole number of milliseconds from 1 to 604800000, or false';
const CHECKOUT = 'checkout: checkout must be the path of a folder, or false';
const WINDOWS_DEVICE = "key: key can't be a device name Windows reserves (con, prn, aux, nul, com0-9 and lpt0-9)";

describe('parseSharedServerOptions', () => {
  const ENTRY = '/work/checkout/dist/main.js';
  const defaults = {
    attachBudgetMs: 15_000,
    replaceOlder: true,
    idleTimeoutMs: 600_000,
    checkout: '/work/checkout/dist',
  };

  it('serves on an owner-only Unix socket by default, and on loopback HTTP on Windows', () => {
    expect(parseSharedServerOptions({ key: 'notes' }, 'darwin', ENTRY)).toEqual({
      key: 'notes',
      transport: 'unix',
      ...defaults,
    });
    expect(parseSharedServerOptions({ key: 'notes' }, 'win32', ENTRY)).toMatchObject({ transport: 'http' });
    expect(parseSharedServerOptions({ key: 'my.notes_2-a', transport: 'http' }, 'linux', ENTRY)).toMatchObject({
      key: 'my.notes_2-a',
      transport: 'http',
    });
  });

  it('takes the attach budget, the upgrade policy, the idle time and the checkout it is given', () => {
    expect(
      parseSharedServerOptions(
        { key: 'notes', attachBudgetMs: 500, replaceOlder: false, idleTimeoutMs: false, checkout: 'relative/dir' },
        'linux',
        ENTRY,
      ),
    ).toMatchObject({
      attachBudgetMs: 500,
      replaceOlder: false,
      idleTimeoutMs: false,
      checkout: path.resolve('relative/dir'),
    });
    expect(parseSharedServerOptions({ key: 'notes', checkout: false }, 'linux', ENTRY).checkout).toBe(false);
  });

  it('watches the working folder when there is no entry file', () => {
    expect(parseSharedServerOptions({ key: 'notes' }, 'linux', undefined).checkout).toBe(process.cwd());
  });

  it.each([
    [{}, 'key: key is required'],
    [{ key: '' }, KEY_FORMAT],
    [{ key: '../up' }, KEY_FORMAT],
    [{ key: 'a'.repeat(65) }, KEY_FORMAT],
    [{ key: '/etc' }, KEY_FORMAT],
    [{ key: 'a\u0000b' }, KEY_FORMAT],
    [{ key: 'caf\u00e9' }, KEY_FORMAT],
    [{ key: 'notes', transport: 'tcp' }, "transport: transport must be 'unix' or 'http'"],
    [{ key: 'notes', port: 4000 }, 'Unrecognized key'],
    [{ key: 'notes', attachBudgetMs: 0 }, ATTACH_BUDGET],
    [{ key: 'notes', attachBudgetMs: 1.5 }, ATTACH_BUDGET],
    [{ key: 'notes', attachBudgetMs: 600_001 }, ATTACH_BUDGET],
    [{ key: 'notes', attachBudgetMs: '100' }, ATTACH_BUDGET],
    [{ key: 'notes', replaceOlder: 'yes' }, 'replaceOlder: replaceOlder must be true or false'],
    [{ key: 'notes', idleTimeoutMs: 0 }, IDLE_TIMEOUT],
    [{ key: 'notes', idleTimeoutMs: true }, IDLE_TIMEOUT],
    [{ key: 'notes', idleTimeoutMs: 604_800_001 }, IDLE_TIMEOUT],
    [{ key: 'notes', checkout: '' }, CHECKOUT],
    [{ key: 'notes', checkout: 'a\u0000b' }, CHECKOUT],
    [{ key: 'notes', checkout: true }, CHECKOUT],
  ])('refuses %j', (input, message) => {
    expect(() => parseSharedServerOptions(input, 'linux', ENTRY)).toThrow(InvalidSharedServerOptionsError);
    expect(() => parseSharedServerOptions(input, 'linux', ENTRY)).toThrow(message);
  });

  it.each([['Notes'], ['NOTES'], ['notes.'], ['notes..']])(
    'refuses %j, whose folder a case-insensitive or Windows file system would share with another key',
    (key) => {
      expect(() => parseSharedServerOptions({ key }, 'linux')).toThrow(KEY_FORMAT);
    },
  );

  it.each([['con'], ['nul'], ['aux.notes'], ['com1'], ['lpt0'], ['prn']])(
    'refuses %j, a device name and not a folder on Windows',
    (key) => {
      expect(() => parseSharedServerOptions({ key }, 'linux')).toThrow(WINDOWS_DEVICE);
    },
  );

  it('refuses a Unix socket on Windows, where it has no file mode to keep it owner-only', () => {
    expect(() => parseSharedServerOptions({ key: 'notes', transport: 'unix' }, 'win32')).toThrow(
      "transport: a Unix socket can't be kept owner-only on Windows; use transport 'http'",
    );
  });

  it('names the options in its message and carries a code', () => {
    try {
      parseSharedServerOptions({ key: '' }, 'linux');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSharedServerOptionsError);
      expect((error as InvalidSharedServerOptionsError).code).toBe('INVALID_SHARED_SERVER_OPTIONS');
      expect((error as Error).message).toMatch(/^runShared\(\) options are invalid: key: /);
    }
  });
});
