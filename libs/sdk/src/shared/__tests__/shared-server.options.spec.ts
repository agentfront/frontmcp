import { InvalidSharedServerOptionsError } from '../../errors';
import { parseSharedServerOptions } from '../shared-server.options';

const KEY_FORMAT =
  'key: key must be 1 to 64 lowercase letters, digits, ".", "_" or "-", starting and ending with a letter or digit';
const WINDOWS_DEVICE = "key: key can't be a device name Windows reserves (con, prn, aux, nul, com0-9 and lpt0-9)";

describe('parseSharedServerOptions', () => {
  it('serves on an owner-only Unix socket by default, and on loopback HTTP on Windows', () => {
    expect(parseSharedServerOptions({ key: 'notes' }, 'darwin')).toEqual({ key: 'notes', transport: 'unix' });
    expect(parseSharedServerOptions({ key: 'notes' }, 'win32')).toEqual({ key: 'notes', transport: 'http' });
    expect(parseSharedServerOptions({ key: 'my.notes_2-a', transport: 'http' }, 'linux')).toEqual({
      key: 'my.notes_2-a',
      transport: 'http',
    });
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
  ])('refuses %j', (input, message) => {
    expect(() => parseSharedServerOptions(input, 'linux')).toThrow(InvalidSharedServerOptionsError);
    expect(() => parseSharedServerOptions(input, 'linux')).toThrow(message);
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
