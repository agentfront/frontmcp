// file: libs/cli/src/commands/build/adapters/wrangler-toml.ts
// Rewrite only the wrangler.toml keys the build owns, leaving everything the
// user put in the file alone.

/** The four top-level keys `frontmcp build --target cloudflare` manages. */
export interface ManagedWranglerFields {
  /** Worker name. Only written when the file does not already declare one. */
  name: string;
  /** Entry module — always rewritten; it has to track the build output (#374). */
  main: string;
  /** Only written when the file does not already declare one. */
  compatibilityDate: string;
  /** Merged into whatever the file already declares, never replacing it. */
  compatibilityFlags: string[];
}

export interface WranglerMergeResult {
  content: string;
  /** Human-readable notes the build should surface (e.g. a name mismatch). */
  warnings: string[];
}

const MANAGED_KEYS = ['name', 'main', 'compatibility_date', 'compatibility_flags'] as const;
type ManagedKey = (typeof MANAGED_KEYS)[number];

interface KeySpan {
  /** Index of the first line of the assignment. */
  start: number;
  /** Index one past the last line of the assignment. */
  end: number;
  /** Raw text to the right of `=`, joined across a multi-line array. */
  rawValue: string;
}

/**
 * A real TOML table header (`[vars]`, `[[kv_namespaces]]`), not a line that
 * merely begins with `[` — a continuation line of a multi-line array does too,
 * and mistaking one for a section would cut the preamble short.
 */
const SECTION_HEADER = /^\[\[?[A-Za-z0-9_.\-"' ]+\]\]?\s*(#.*)?$/;

function isSectionHeader(line: string): boolean {
  return SECTION_HEADER.test(line.trim());
}

function isComment(line: string): boolean {
  return line.trim().startsWith('#');
}

/** Extract every double- or single-quoted string in a TOML fragment, in order. */
export function parseTomlStringArray(rawValue: string): string[] {
  const matches = rawValue.match(/"(?:\\.|[^"\\])*"|'[^']*'/g);
  if (!matches) return [];
  return matches.map((token) => token.slice(1, -1));
}

function parseTomlString(rawValue: string): string | undefined {
  const [first] = parseTomlStringArray(rawValue);
  return first;
}

/**
 * Locate the top-level assignments for the managed keys.
 *
 * Only the preamble — everything before the first `[section]` header — is
 * scanned, so a `name` inside `[vars]` or `[[kv_namespaces]]` is never
 * mistaken for the worker name.
 */
function findManagedKeySpans(lines: string[]): { spans: Map<ManagedKey, KeySpan>; preambleEnd: number } {
  const spans = new Map<ManagedKey, KeySpan>();
  let preambleEnd = lines.length;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (isSectionHeader(line)) {
      preambleEnd = index;
      break;
    }
    if (isComment(line)) continue;

    const assignment = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/);
    if (!assignment) continue;

    const key = assignment[1] as ManagedKey;
    if (!MANAGED_KEYS.includes(key)) continue;

    let rawValue = assignment[2];
    let end = index + 1;
    // A `[` that never closes on this line is a multi-line array; consume it.
    if (rawValue.trimStart().startsWith('[') && !rawValue.includes(']')) {
      while (end < lines.length && !lines[end].includes(']')) {
        rawValue += `\n${lines[end]}`;
        end++;
      }
      if (end < lines.length) {
        rawValue += `\n${lines[end]}`;
        end++;
      }
    }
    spans.set(key, { start: index, end, rawValue });
    index = end - 1;
  }

  // A file with no section header at all is all preamble; trim the trailing
  // blank lines so appended keys land next to the existing ones.
  if (preambleEnd === lines.length) {
    while (preambleEnd > 0 && lines[preambleEnd - 1].trim() === '') preambleEnd--;
  }

  return { spans, preambleEnd };
}

function renderFlags(flags: string[]): string {
  return `[${flags.map((flag) => `"${flag}"`).join(', ')}]`;
}

/**
 * Render a complete `wrangler.toml` from the managed fields alone. Used when no
 * file exists yet.
 */
export function renderWranglerToml(fields: ManagedWranglerFields): string {
  return [
    `name = "${fields.name}"`,
    `main = "${fields.main}"`,
    `compatibility_date = "${fields.compatibilityDate}"`,
    `compatibility_flags = ${renderFlags(fields.compatibilityFlags)}`,
    '',
  ].join('\n');
}

/**
 * Merge the managed fields into an existing `wrangler.toml`.
 *
 * Issue #535: the build used to render the whole file from a four-line
 * template, which silently renamed the worker to `frontmcp-worker` and deleted
 * `[vars]`, every binding and every comment. Only the managed keys are touched
 * now, and of those only `main` is overwritten unconditionally — it has to
 * track the build output, which is what #374 fixed.
 *
 * - `name` / `compatibility_date`: kept as the file declares them; written only
 *   when absent. A `name` that disagrees with `frontmcp.config.ts` produces a
 *   warning rather than a silent rename.
 * - `compatibility_flags`: the union of the file's flags and the required ones,
 *   preserving the file's order, so a worker can never lose `nodejs_compat`.
 * - Everything else — sections, bindings, triggers, comments — is untouched.
 */
export function mergeWranglerToml(existing: string, fields: ManagedWranglerFields): WranglerMergeResult {
  const warnings: string[] = [];
  // Keep whatever line ending the file already uses so the build doesn't
  // rewrite every line of a CRLF checkout.
  const lineEnding = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing.split(/\r?\n/);
  const { spans, preambleEnd } = findManagedKeySpans(lines);

  const declaredName = spans.has('name') ? parseTomlString(spans.get('name')!.rawValue) : undefined;
  if (declaredName && declaredName !== fields.name) {
    warnings.push(
      `wrangler.toml declares name = "${declaredName}" but frontmcp.config resolves to "${fields.name}". ` +
        `Keeping "${declaredName}" — set deployments[].wrangler.name to silence this.`,
    );
  }

  const declaredFlags = spans.has('compatibility_flags')
    ? parseTomlStringArray(spans.get('compatibility_flags')!.rawValue)
    : [];
  const mergedFlags = Array.from(new Set([...declaredFlags, ...fields.compatibilityFlags]));

  const replacements = new Map<ManagedKey, string>([['main', `main = "${fields.main}"`]]);
  if (!spans.has('name')) replacements.set('name', `name = "${fields.name}"`);
  if (!spans.has('compatibility_date')) {
    replacements.set('compatibility_date', `compatibility_date = "${fields.compatibilityDate}"`);
  }
  if (mergedFlags.length > 0) {
    replacements.set('compatibility_flags', `compatibility_flags = ${renderFlags(mergedFlags)}`);
  }

  const spanByStart = new Map<number, { key: ManagedKey; end: number }>();
  for (const [key, span] of spans) spanByStart.set(span.start, { key, end: span.end });

  const pending: string[] = [];
  for (const [key, rendered] of replacements) {
    if (!spans.has(key)) pending.push(rendered);
  }

  const output: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (index === preambleEnd && pending.length > 0) {
      output.push(...pending.splice(0));
    }

    const span = spanByStart.get(index);
    if (span) {
      const rendered = replacements.get(span.key);
      // No replacement means the file's own value wins, verbatim.
      if (rendered !== undefined) output.push(rendered);
      else output.push(...lines.slice(index, span.end));
      index = span.end - 1;
      continue;
    }

    output.push(lines[index]);
  }

  if (pending.length > 0) output.push(...pending);

  return { content: output.join(lineEnding), warnings };
}
