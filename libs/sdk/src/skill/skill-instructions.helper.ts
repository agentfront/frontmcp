/**
 * Helpers for injecting bundle skill `instructions` into the MCP `initialize`
 * response.
 *
 * Design notes:
 * - The `initialize` response's `instructions` field is server-side prompt
 *   text that clients usually inject verbatim into the model context. Pushing
 *   every skill's full SKILL.md body would balloon every initialize response
 *   and burn token budget on tool calls. Instead, we ship a bounded catalog
 *   summary (`**name**: description`) plus a pointer to the `skills://catalog`
 *   resource and the `skills://{name}/SKILL.md` resource template for the full
 *   content.
 * - Resolution is sync — the registry already holds metadata at boot. The
 *   per-skill `instructions` markdown body stays lazy and reachable through
 *   `skills://` resources or the `skills/search` and `skills/load` MCP
 *   extension methods.
 * - Off / replace policies short-circuit before we touch the registry, so a
 *   server with `injectInstructions: 'off'` pays zero cost regardless of how
 *   many bundle skills are loaded.
 * - The catalog is recomputed lazily on every `initialize` request (see
 *   `initialize-request.handler.ts`), so dynamic skill registrations made
 *   after the server boots are reflected in subsequent reconnects without a
 *   restart.
 */

import type { SkillRegistryInterface } from './skill.registry';

export type InjectInstructionsPolicy = 'off' | 'append' | 'prepend' | 'replace';

const DEFAULT_POLICY: InjectInstructionsPolicy = 'append';
/**
 * Hard ceiling on the catalog block. Keeps the initialize payload bounded
 * regardless of how many skills are registered. ~16 KB fits comfortably in a
 * single MCP message and stays well under most LLM context budgets even when
 * combined with user-provided server instructions.
 */
const MAX_SKILL_CATALOG_CHARS = 16_000;

/**
 * Maximum overhead reserved for the truncation footer (worst-case length of
 * `_(catalog truncated — showing X of Y skills; use the skills://catalog
 * resource to browse)_` with realistic counts). We reserve this up-front so
 * the final string never exceeds `MAX_SKILL_CATALOG_CHARS` after the footer
 * is appended.
 */
const TRUNCATION_FOOTER_RESERVE = 160;

interface ComposeOptions {
  /** User-provided server instructions from `@FrontMcp({ instructions })`. */
  userInstructions?: string;
  /** Framework-emitted hints (e.g. channel reply-tool guidance). */
  channelInstructions?: string;
  /** Skill registry; pass `undefined` if skills are disabled. */
  skillRegistry?: SkillRegistryInterface;
  /** Merge policy from `skillsConfig.injectInstructions`. */
  policy?: InjectInstructionsPolicy;
}

/**
 * Sanitize a skill description so it can be embedded as a single bullet in a
 * markdown catalog without breaking out of its line context.
 *
 * - Collapses whitespace (newlines, tabs, multiple spaces) to single spaces.
 * - Escapes backslashes FIRST so a hostile `\*` in the input can't smuggle a
 *   literal `\` into the output that pairs with our own escape and re-enables
 *   the metacharacter (CodeQL: js/incomplete-sanitization).
 * - Escapes backticks so embedded code spans don't swallow the closing fence.
 * - Strips standalone `---` lines (would collide with section separators or
 *   render as a horizontal rule).
 * - Escapes `*` and `_` so embedded `**bold**` / `_em_` / list markers don't
 *   reflow our `**name**: description` formatting.
 * - Escapes `[` so embedded `[link](url)` syntax stays inert.
 *
 * Names themselves are NOT escaped — they pass kebab-case validation
 * (≤64 chars, `[a-z0-9-]+`) and never contain markdown specials. If the name
 * regex is ever relaxed, this helper must escape names too.
 *
 * Exported so the security test suite can pin down the escape ordering.
 */
export function sanitizeDescription(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*-{3,}\s*$/g, '') // standalone `---` lines
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .trim();
}

const CATALOG_HEADER =
  'Available skills (read the `skills://catalog` resource to browse, ' +
  'or `skills://{name}/SKILL.md` for full content):';

/**
 * Build a bounded catalog summary of MCP-visible skills.
 *
 * Output shape:
 *
 * ```
 * Available skills (read the `skills://catalog` resource to browse, or `skills://{name}/SKILL.md` for full content):
 *
 * - **skill_name**: short description
 * - **another_skill**: ...
 * ```
 *
 * Returns `''` if the registry is missing or has no MCP-visible skills.
 * The total length is hard-capped at `MAX_SKILL_CATALOG_CHARS` (footer
 * reserve included), with a `_(catalog truncated — showing N of M skills…)_`
 * footer appended when the cap is hit.
 */
export function buildSkillsCatalogSummary(skillRegistry: SkillRegistryInterface | undefined): string {
  if (!skillRegistry) return '';

  // `visibility: 'mcp'` matches both `'mcp'` and `'both'` (see `getSkills`).
  const skills = skillRegistry.getSkills({ visibility: 'mcp' });
  if (skills.length === 0) return '';

  const lines: string[] = [CATALOG_HEADER, ''];

  let truncated = false;
  let shownCount = 0;
  let charCount = lines.join('\n').length;
  // Reserve room for the truncation footer up-front so the final string
  // (including the footer) never exceeds MAX_SKILL_CATALOG_CHARS.
  const effectiveCap = MAX_SKILL_CATALOG_CHARS - TRUNCATION_FOOTER_RESERVE;
  for (const skill of skills) {
    const meta = skill.metadata;
    const name = meta.name;
    const description = sanitizeDescription(meta.description);
    const line = description ? `- **${name}**: ${description}` : `- **${name}**`;
    if (charCount + line.length + 1 > effectiveCap) {
      truncated = true;
      break;
    }
    lines.push(line);
    charCount += line.length + 1;
    shownCount += 1;
  }

  if (truncated) {
    lines.push(
      '',
      `_(catalog truncated — showing ${shownCount} of ${skills.length} skills; ` +
        'read `skills://catalog` to browse)_',
    );
  }

  return lines.join('\n');
}

/**
 * Compose the final `instructions` string for the MCP `initialize` response
 * by merging server instructions, channel hints, and the skill catalog
 * summary per the configured policy.
 *
 * Sections are joined with `\n\n---\n\n` so clients can render them as
 * separate logical blocks if they wish.
 *
 * Policy semantics:
 * - `'off'`: skips the skill catalog; user + channel hints are still emitted.
 * - `'append'` (default): user + channel + catalog, in that order.
 * - `'prepend'`: catalog + channel + user.
 * - `'replace'`: only the user-supplied instructions are emitted. **Falls
 *   back to `'append'` semantics when `userInstructions` is empty/undefined**
 *   so a misconfigured server doesn't silently drop the catalog and channel
 *   hints. Document this in the schema if you change it.
 */
export function composeInitializeInstructions(options: ComposeOptions): string {
  const policy = options.policy ?? DEFAULT_POLICY;
  const user = (options.userInstructions ?? '').trim();
  const channel = (options.channelInstructions ?? '').trim();

  if (policy === 'replace') {
    if (user.length > 0) {
      // Server-supplied prompt wins; channels + skills are silenced.
      return user;
    }
    // Fallback: an empty 'replace' would silently drop everything. Treat as
    // 'append' so channels + skill catalog still surface.
  }

  if (policy === 'off') {
    // Skip skill catalog; keep server + channel hints since they're also
    // bounded and framework-level.
    return joinSections([user, channel]);
  }

  const catalog = buildSkillsCatalogSummary(options.skillRegistry);
  if (policy === 'prepend') {
    return joinSections([catalog, channel, user]);
  }
  // 'append' (default and 'replace'-with-empty-user fallback)
  return joinSections([user, channel, catalog]);
}

/**
 * Build the channel-instructions hint emitted to clients when the scope
 * exposes any channel. Shared by stdio (`front-mcp.ts`) and HTTP
 * (`transport.local.adapter.ts`) so both transports stay in sync.
 *
 * Returns `''` when no channels are registered.
 */
export function buildChannelInstructions(channels: ChannelRegistryLike | undefined): string {
  if (!channels?.hasAny()) return '';
  const hasTwoWay = channels.getChannelInstances().some((ch) => ch.twoWay);
  return hasTwoWay
    ? 'Events arrive as <channel> tags. Reply with the channel-reply tool.'
    : 'Events arrive as <channel> tags.';
}

/**
 * Minimal duck-typed surface for channel-registry consumers used by
 * `buildChannelInstructions`. Keeps this helper free of a hard dependency on
 * the channel module so it remains importable from the public barrel.
 */
interface ChannelRegistryLike {
  hasAny(): boolean;
  getChannelInstances(): Array<{ twoWay?: boolean }>;
}

function joinSections(sections: Array<string | undefined>): string {
  return sections
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('\n\n---\n\n');
}
