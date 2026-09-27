// file: plugins/plugin-codecall/src/utils/client-error-message.ts

/**
 * Stack frames embedded in a message (`\n    at fn (/srv/app/x.js:1:2)`). Only spaces and tabs
 * before `at`: `\s*` would also match newlines and rescan a run of blank lines from each one.
 */
const EMBEDDED_STACK_FRAME_RE = /\n[ \t]*at\s[^\n]*/g;

/**
 * A quoted absolute path, whatever it contains (Node's fs errors quote the path they name):
 * POSIX (`/…`, `~/…`), Windows drive (`C:\…`, `C:/…`) or UNC (`\\server\…`).
 */
const QUOTED_PATH_RE = /(['"`])((?:~?\/|[A-Za-z]:[\\/]|\\\\)[^\s'"`\\/][^'"`\n]*)\1/g;

/**
 * A URL with a scheme. Kept as it is, except a `file:` URL, which is a path. The scheme is capped
 * at 32 characters: unbounded, every word of `a.a.a.…` would scan to the end of the message.
 */
const URL_RE = /\b[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s'"`<>]*/g;

const POSIX_SEGMENT = String.raw`[^\s/\\'"\x60<>|,;:()\[\]{}]+`;
const WINDOWS_SEGMENT = String.raw`[^\s/\\'"\x60<>|,;:*?]+`;

/**
 * Path segments joined by `separator`. A segment another separator follows may hold up to two
 * single spaces (`my app`, `Program Files (x86)`); the last one may not, so the words after an
 * unquoted path are left alone.
 */
function segments(segment: string, separator: string): string {
  const spaced = `${segment}(?: ${segment}){0,2}`;
  return `(?:(?:${spaced}${separator})+(?:${segment})?|${segment})`;
}

/**
 * An unquoted absolute path. A POSIX path must start the word (not `1/2`, `and/or`, `docs/x`,
 * `./x`), and needs a character after the slash (not `a / b`).
 */
const UNQUOTED_PATH_RE = new RegExp(
  [
    String.raw`(?<![\w.~/\\)\]-])~?/${segments(POSIX_SEGMENT, '/')}`,
    String.raw`(?<![\w\\/])[A-Za-z]:[\\/]${segments(WINDOWS_SEGMENT, String.raw`[\\/]`)}?`,
    String.raw`(?<![\w\\])\\\\${segments(WINDOWS_SEGMENT, String.raw`[\\/]`)}`,
  ].join('|'),
  'g',
);

function redactPaths(text: string): string {
  return text.replace(QUOTED_PATH_RE, '$1[path]$1').replace(UNQUOTED_PATH_RE, '[path]');
}

/**
 * The message a client may see for a script or tool error: no stack frames and no absolute
 * server paths, in every environment. URLs other than `file:` URLs are kept.
 */
export function toClientErrorMessage(message: string | undefined): string {
  if (!message) return '';
  return redactAbsolutePaths(message.replace(EMBEDDED_STACK_FRAME_RE, ''));
}

/**
 * `text` with every absolute path (POSIX, `~/`, Windows drive, UNC, `file:` URL, or quoted) replaced
 * by `[path]`, and everything else, other URLs included, left as it is. Runs in linear time.
 */
export function redactAbsolutePaths(text: string): string {
  let result = '';
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    result += redactPaths(text.slice(last, start));
    result += /^file:/i.test(match[0]) ? '[path]' : match[0];
    last = start + match[0].length;
  }
  return result + redactPaths(text.slice(last));
}
