/**
 * `codecall:execute` returns script and tool error messages to the client, so they must not name
 * server files: no stack frames, and no absolute paths in any of the forms Node and tools produce.
 */
import { toClientErrorMessage } from '../utils/client-error-message';

describe('toClientErrorMessage', () => {
  it.each([
    ['a single-segment POSIX path', 'failed reading /secret.txt', 'failed reading [path]'],
    ['a multi-segment POSIX path', 'failed reading /srv/app/secret.json', 'failed reading [path]'],
    ['a POSIX path with spaces', 'failed reading /srv/my app/secrets/config.json', 'failed reading [path]'],
    ['a trailing-slash directory', 'cannot list /srv/app/', 'cannot list [path]'],
    ['a home-relative path', 'cannot open ~/.ssh/id_rsa', 'cannot open [path]'],
    ['a file URL', 'import failed: file:///srv/app/dist/main.js', 'import failed: [path]'],
    ['a Windows drive path', 'failed reading C:\\srv\\app\\secret.json', 'failed reading [path]'],
    ['a Windows path with spaces', 'failed reading C:\\Program Files\\FrontMCP\\secret.json', 'failed reading [path]'],
    [
      'a Windows path with spaces and parentheses',
      'failed reading C:\\Program Files (x86)\\FrontMCP\\secret.json',
      'failed reading [path]',
    ],
    ['a Windows path with forward slashes', 'failed reading C:/Users/ops/secret.json', 'failed reading [path]'],
    ['a UNC path', 'failed reading \\\\fileserver\\share\\secret.json', 'failed reading [path]'],
    ['a line and column suffix', 'boom in /srv/app/x.js:10:5', 'boom in [path]:10:5'],
  ])('redacts %s', (_label, message, expected) => {
    expect(toClientErrorMessage(message)).toBe(expected);
  });

  it.each([
    ['single quotes', "ENOENT: no such file or directory, open '/srv/my app/very secret folder/config.json'"],
    ['double quotes', 'ENOENT: no such file or directory, open "/srv/my app/very secret folder/config.json"'],
    ['backticks', 'ENOENT: no such file or directory, open `C:\\Users\\Jane Doe\\My Secrets\\config.json`'],
  ])('redacts a quoted path in %s whatever it contains', (_label, message) => {
    const redacted = toClientErrorMessage(message);

    expect(redacted).toMatch(/^ENOENT: no such file or directory, open (['"`])\[path\]\1$/);
  });

  it('redacts every path in a message', () => {
    expect(toClientErrorMessage('cannot move /srv/a.json to /srv/b.json')).toBe('cannot move [path] to [path]');
  });

  it('drops embedded stack frames', () => {
    expect(
      toClientErrorMessage("Cannot find module '/srv/app/pkg/index.js'\n    at load (/srv/app/dist/main.js:10:5)"),
    ).toBe("Cannot find module '[path]'");
  });

  it.each([
    ['an https URL', 'upstream said 404 for https://api.example.com/v1/users?id=2'],
    ['an http URL', 'fetch http://localhost:3000/mcp failed'],
    ['a ratio', 'expected 1/2 of the quota, got 3/4'],
    ['a date', 'expired on 2026/09/27'],
    ['a MIME type', 'unsupported content-type application/json'],
    ['and/or', 'pass a name and/or an id'],
    ['a lone slash', 'use a / b to divide'],
    ['relative paths', 'see docs/guide.md and ./local/file.txt'],
    ['plain words', 'Cannot read properties of undefined (reading "name")'],
  ])('keeps %s', (_label, message) => {
    expect(toClientErrorMessage(message)).toBe(message);
  });

  // A script chooses the message it throws, so a crafted one must not make redaction slow.
  it.each([
    ['dotted words', 'a.'.repeat(100_000)],
    ['blank lines', '\n'.repeat(100_000)],
    ['spaced path segments', ' /a b c'.repeat(30_000)],
    ['unclosed quotes', "'/a".repeat(60_000)],
  ])('redacts a long message of %s in linear time', (_label, message) => {
    const started = Date.now();
    toClientErrorMessage(message);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('returns an empty string for no message', () => {
    expect(toClientErrorMessage(undefined)).toBe('');
    expect(toClientErrorMessage('')).toBe('');
  });
});
