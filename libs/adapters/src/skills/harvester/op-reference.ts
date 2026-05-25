// file: libs/adapters/src/skills/harvester/op-reference.ts
//
// Markdown harvester for OpenAPI operation references.
//
// In a skill bundle, any markdown file (SKILL.md / references/*.md / examples/*.md)
// can mention an OpenAPI operation in one of two equivalent forms:
//
//   1. URI form:        op://<spec-id>/<operation-id>
//                       — recognised both bare and inside `[text](op://...)` links.
//
//   2. Wikilink form:   [[op:<spec-id>/<operation-id>]]
//                       — Obsidian / Foam / Roam-style. Convenient in prose.
//
// The harvester turns these mentions into a structured list. A later pass
// validates them against the OpenAPI specs in the project (see
// `validateOpReferences`) and surfaces unknown / typo'd references as lint
// diagnostics.
//
// The implementation is pure-string + zero-dep so it runs in Node, browsers,
// Cloudflare Workers, and the future LSP without runtime conditioning.

/**
 * Syntactic form a reference was written in. The two are interchangeable at
 * the build pipeline level but worth preserving for diagnostics (e.g. "you
 * used `op://` inside an example — wikilink is more idiomatic here").
 */
export type OpReferenceSyntax = 'uri' | 'wikilink';

/** Zero-based source location. */
export interface SourceLocation {
  /** 1-based line number (matches editor + LSP conventions). */
  line: number;
  /** 1-based column number. */
  column: number;
  /** Absolute character offset from the start of the source. */
  offset: number;
}

/** A single parsed `op://...` or `[[op:...]]` reference. */
export interface OpReference {
  /** Spec identifier as it appeared in the reference (e.g. `acme-api`). */
  spec: string;
  /** Operation identifier as it appeared (e.g. `getUserById`). */
  operationId: string;
  /** Which markdown syntax produced this reference. */
  syntax: OpReferenceSyntax;
  /** The exact substring that matched, useful for editor decorations. */
  raw: string;
  /** Where the match starts in the source markdown. */
  location: SourceLocation;
}

/**
 * Spec ID grammar. Permits letters, digits, underscores, dots, and dashes.
 *
 * Permitting dashes here intentionally: an OpenAPI spec file is often named
 * `acme-api.yaml` and using its stem as the spec id is the most ergonomic
 * default. (Dashes are NOT valid JavaScript identifiers so the namespace
 * generator over in `plugin-codecall` will refuse to surface them as bindings
 * — that's the right place to surface the rename hint, not here.)
 *
 * MUST start with a letter or digit. No consecutive dots or dashes are
 * forbidden at the syntax level — the build can warn if it wants.
 */
const SPEC_ID_RE = '[A-Za-z0-9][A-Za-z0-9_.-]*';

/**
 * Operation ID grammar. Constrained to a valid JavaScript identifier (no
 * dashes, no dots) so the generated binding `acme.getUserById(...)` is always
 * legal syntax in AgentScript.
 */
const OPERATION_ID_RE = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * Combined matcher.
 *
 * Branch A — URI form `op://<spec>/<op>`:
 *   matched by `op:\/\/(<spec>)\/(<op>)`. The leading `op:` is anchored with a
 *   non-word lookbehind so we don't mis-match a bare word like `top://foo`.
 *
 * Branch B — Wikilink form `[[op:<spec>/<op>]]`:
 *   matched by `\[\[op:(<spec>)\/(<op>)\]\]`. Tolerates a single space after
 *   `[[op:` because that's a common typo.
 */
// Trailing-boundary lookahead. Without it, greedy matching means
// `op://acme/get-user` (intended as an invalid op id with a dash) would
// partial-match to `op://acme/get` and leave `-user` orphaned in the source.
//
// We reject three "continuation" patterns at the boundary:
//   - another identifier char (would never happen with greedy matching, but
//     belt-and-braces)
//   - a dash         — strong signal of "kebab-case identifier continues"
//   - a dot followed by another identifier  — signal of "namespace.method continues"
//
// A bare period (sentence-ending) is permitted so that `op://acme/getOrder.`
// at the end of a sentence still matches.
const TRAILING_BOUNDARY = String.raw`(?![A-Za-z0-9_\-])(?!\.[A-Za-z0-9_])`;

const REFERENCE_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])op:\/\/(${SPEC_ID_RE})\/(${OPERATION_ID_RE})${TRAILING_BOUNDARY}` +
    `|` +
    String.raw`\[\[op:\s?(${SPEC_ID_RE})\/(${OPERATION_ID_RE})\]\]`,
  'g',
);

/**
 * Extract every `op://` or `[[op:...]]` reference from a markdown source string.
 *
 * The returned list preserves source order and includes accurate line/column
 * coordinates suitable for editor diagnostics. Duplicate references are NOT
 * deduplicated — that's the caller's choice (a reference appearing twice in a
 * skill's instructions is still a single allowed-op, but a linter may want
 * separate diagnostics per occurrence).
 *
 * @param markdown - The markdown source to scan. May be empty.
 * @returns Ordered list of parsed references.
 */
export function extractOpReferences(markdown: string): OpReference[] {
  if (typeof markdown !== 'string' || markdown.length === 0) return [];

  const refs: OpReference[] = [];
  const lineStarts = computeLineStarts(markdown);

  // RegExp.exec with `g` flag walks the string statefully — reset before use
  // so callers can re-invoke without mutating a shared regex.
  REFERENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(markdown)) !== null) {
    const offset = match.index;
    const [raw, uriSpec, uriOp, wikiSpec, wikiOp] = match;

    // Exactly one of (uriSpec,uriOp) and (wikiSpec,wikiOp) is defined — the
    // alternation guarantees it.
    const isWikilink = wikiSpec !== undefined && wikiOp !== undefined;
    const spec = isWikilink ? wikiSpec : uriSpec;
    const operationId = isWikilink ? wikiOp : uriOp;

    refs.push({
      spec,
      operationId,
      syntax: isWikilink ? 'wikilink' : 'uri',
      raw,
      location: offsetToLocation(offset, lineStarts),
    });
  }

  return refs;
}

/**
 * Diagnostic emitted while validating extracted references against the set of
 * OpenAPI operations known to the project.
 */
export interface OpReferenceDiagnostic {
  /** The reference that produced the diagnostic. */
  ref: OpReference;
  /** Why the reference is problematic. */
  kind: 'unknown-spec' | 'unknown-operation';
  /** Human-readable explanation suitable for a CLI lint message. */
  message: string;
  /** Optional list of `${spec}/${op}` strings that look close to the reference. */
  suggestions?: string[];
}

/**
 * Container describing the OpenAPI operations the project knows about. Each
 * spec is a map from operationId to (whatever the loader needs to attach;
 * the validator only cares about the keys).
 */
export type KnownOps = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Build a `KnownOps` map from a flat list of `${spec}/${operationId}` strings.
 * Convenience helper for callers (tests, harvester loaders) that already have
 * the flat shape.
 */
export function buildKnownOps(entries: ReadonlyArray<string>): KnownOps {
  const map = new Map<string, Set<string>>();
  for (const entry of entries) {
    const slash = entry.indexOf('/');
    if (slash <= 0 || slash === entry.length - 1) continue;
    const spec = entry.slice(0, slash);
    const op = entry.slice(slash + 1);
    let set = map.get(spec);
    if (!set) {
      set = new Set();
      map.set(spec, set);
    }
    set.add(op);
  }
  return map;
}

/**
 * Validate a list of extracted references against the known OpenAPI ops.
 * Returns one diagnostic per unknown reference, in source order.
 *
 * `suggestions` is populated with up to 3 closest matches (case-insensitive
 * prefix or fuzzy substring) when the operationId is unknown — that's the
 * common "typo" path. Suggestions for unknown specs list every known spec id.
 */
export function validateOpReferences(refs: ReadonlyArray<OpReference>, knownOps: KnownOps): OpReferenceDiagnostic[] {
  const diagnostics: OpReferenceDiagnostic[] = [];

  for (const ref of refs) {
    const specOps = knownOps.get(ref.spec);
    if (!specOps) {
      diagnostics.push({
        ref,
        kind: 'unknown-spec',
        message: `Unknown OpenAPI spec "${ref.spec}" referenced as ${ref.raw}`,
        suggestions: Array.from(knownOps.keys()).sort(),
      });
      continue;
    }
    if (!specOps.has(ref.operationId)) {
      diagnostics.push({
        ref,
        kind: 'unknown-operation',
        message: `Unknown operationId "${ref.operationId}" in spec "${ref.spec}" (${ref.raw})`,
        suggestions: suggestSimilarOps(ref.operationId, specOps),
      });
    }
  }

  return diagnostics;
}

/**
 * Deduplicate a list of references down to the unique `(spec, operationId)`
 * pairs they touch. The order of first appearance is preserved.
 *
 * Used by the loader to compute a skill's `allowed-operations` set from the
 * mentions across SKILL.md / references/ / examples/.
 */
export function dedupeOpReferences(refs: ReadonlyArray<OpReference>): Array<{
  spec: string;
  operationId: string;
}> {
  const seen = new Set<string>();
  const result: Array<{ spec: string; operationId: string }> = [];
  for (const ref of refs) {
    const key = `${ref.spec}/${ref.operationId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ spec: ref.spec, operationId: ref.operationId });
  }
  return result;
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Pre-compute the absolute offset of the start of each line. */
function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/**
 * Convert an absolute character offset to a 1-based (line, column) pair using
 * a pre-computed list of line-start offsets. Binary search keeps the cost
 * logarithmic in the number of lines.
 */
function offsetToLocation(offset: number, lineStarts: ReadonlyArray<number>): SourceLocation {
  // Binary search for the largest line-start index <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  const line = lo + 1; // 1-based
  const column = offset - lineStarts[lo] + 1; // 1-based
  return { line, column, offset };
}

/**
 * Suggest up to three operation IDs from `known` that look similar to
 * `query`. Prefers prefix matches first, then case-insensitive substring,
 * then a coarse Levenshtein bucket. Sorting is stable on the operation name
 * so the output is deterministic.
 */
function suggestSimilarOps(query: string, known: ReadonlySet<string>): string[] {
  if (known.size === 0) return [];
  const q = query.toLowerCase();
  const candidates = Array.from(known);

  const prefix = candidates.filter((c) => c.toLowerCase().startsWith(q));
  const substring = candidates.filter((c) => !prefix.includes(c) && c.toLowerCase().includes(q));
  const close = candidates
    .filter((c) => !prefix.includes(c) && !substring.includes(c))
    .filter((c) => levenshtein(q, c.toLowerCase()) <= Math.max(2, Math.floor(q.length / 4)));

  return [...prefix, ...substring, ...close].slice(0, 3);
}

/** Iterative Levenshtein with a two-row buffer; bounded for short identifiers. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}
