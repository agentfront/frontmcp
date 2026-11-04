/**
 * Helpers for injecting bundle skill `instructions` into the MCP `initialize`
 * response.
 *
 * Design notes:
 * - The `initialize` response's `instructions` field is server-side prompt
 *   text that clients usually inject verbatim into the model context. Pushing
 *   every skill's full SKILL.md body would balloon every initialize response
 *   and burn token budget on tool calls. Instead, the default `'compact'`
 *   policy ships one line with the skill count, and `'append'`, `'prepend'`
 *   and `'replace'` a bounded catalog summary (`**name**: description`). Both
 *   point to where the full content is served: the SEP-2640
 *   `skill://index.json` resource, or the `skills/search` and `skills/load`
 *   MCP extension methods when `skillsConfig.mcpResources` is false and no
 *   `skill://` resource exists.
 * - Resolution is sync — the registry already holds metadata at boot. The
 *   per-skill `instructions` markdown body stays lazy.
 * - Off / replace policies short-circuit before we touch the registry, so a
 *   server with `injectInstructions: 'off'` pays zero cost regardless of how
 *   many bundle skills are loaded.
 * - The catalog is recomputed lazily on every `initialize` request (see
 *   `initialize-request.handler.ts`), so dynamic skill registrations made
 *   after the server boots are reflected in subsequent reconnects without a
 *   restart.
 * - Transports compose it per caller with {@link composeCallerInstructions}:
 *   the compact line, the catalog and the SEP-2640 hints only count or name
 *   skills the skill authorities and the `skills:filter` flow let that caller
 *   see, like `skills/list`.
 */

import { resolveClientProfile } from '../answer/client-profile';
import type { ScopeEntry, SkillEntry } from '../common';
import { callSurfaceOf } from '../common/availability';
import { mcpRequestSurface } from '../transport/mcp-handlers/mcp-surface';
import { SKILL_INDEX_URI } from './sep-2640/sep-2640.constants';
import { filterSkillsByAuthorities } from './skill-authorities.helper';
import { findSkillCatalogSource, type SkillCatalogPointers } from './skill-catalog-source';
import { filterServableSkills } from './skill-filter.helper';
import type { SkillRegistryInterface } from './skill.registry';

export type InjectInstructionsPolicy = 'off' | 'compact' | 'append' | 'prepend' | 'replace';

const DEFAULT_POLICY: InjectInstructionsPolicy = 'compact';
/**
 * Hard ceiling on the catalog block. Keeps the initialize payload bounded
 * regardless of how many skills are registered. ~16 KB fits comfortably in a
 * single MCP message and stays well under most LLM context budgets even when
 * combined with user-provided server instructions.
 */
const MAX_SKILL_CATALOG_CHARS = 16_000;

/**
 * Maximum overhead reserved for the truncation footer (worst-case length of
 * `_(catalog truncated — showing X of Y skills; <pointer>)_` with realistic
 * counts). We reserve this up-front so the final string never exceeds
 * `MAX_SKILL_CATALOG_CHARS` after the footer is appended.
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
  /** `skillsConfig.mcpResources`; when false the catalog points at the `skills/*` methods. */
  mcpResources?: boolean;
  /** The skills the catalog lists; defaults to every MCP-visible skill in `skillRegistry`. */
  skills?: readonly SkillEntry[];
  /** How the catalog tells a model to load skills; defaults by `mcpResources`. */
  pointers?: SkillCatalogPointers;
}

export interface SkillsCatalogSummaryOptions {
  /** `skillsConfig.mcpResources`; when false no `skill://` resource is served. Defaults to true. */
  mcpResources?: boolean;
  /** The skills to list, such as those a caller may see; defaults to every MCP-visible skill in the registry. */
  skills?: readonly SkillEntry[];
  /**
   * How the catalog tells a model to load and find skills, such as a plugin's own tools. Defaults to the
   * `skill://index.json` resource, or the `skills/*` requests when `mcpResources` is false.
   */
  pointers?: SkillCatalogPointers;
}

type CatalogPointers = SkillCatalogPointers;

function pointersFor(options: SkillsCatalogSummaryOptions): CatalogPointers {
  return options.pointers ?? (options.mcpResources === false ? METHOD_POINTERS : RESOURCE_POINTERS);
}

const RESOURCE_POINTERS: CatalogPointers = {
  header: `Available skills (read the \`${SKILL_INDEX_URI}\` resource for each skill's \`SKILL.md\` URI):`,
  truncationHint: `read \`${SKILL_INDEX_URI}\` to browse`,
  compact: `the \`${SKILL_INDEX_URI}\` resource lists each skill's \`SKILL.md\` URI.`,
};

const METHOD_POINTERS: CatalogPointers = {
  header: 'Available skills (load full content with the `skills/load` request, or find others with `skills/search`):',
  truncationHint: 'use `skills/search` to find the rest',
  compact: 'find one with the `skills/search` request and load it with `skills/load`.',
};

/** The skills the instructions count or list; `visibility: 'mcp'` matches both `'mcp'` and `'both'` (see `getSkills`). */
function listedSkills(
  skillRegistry: SkillRegistryInterface | undefined,
  options: SkillsCatalogSummaryOptions,
): readonly SkillEntry[] {
  return options.skills ?? skillRegistry?.getSkills({ visibility: 'mcp' }) ?? [];
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

/** Max chars a skill NAME may occupy in the catalog (prevents one skill dominating). */
const MAX_SKILL_NAME_CHARS = 80;

/**
 * Sanitize a skill NAME for safe embedding as a bold catalog label. The name is
 * attacker-influenced (bundle-supplied) and was previously interpolated RAW into
 * `- **${name}**:` — a name with NEWLINES could break out of its bullet and
 * inject fake catalog lines / "SYSTEM:" framing into the catalog (surfaced in the
 * `search_skill` tool description AND the initialize `instructions`). Strip all
 * line breaks + control chars (the STRUCTURAL injection vector), collapse
 * whitespace, and hard-cap the length. Emphasis chars (`_`/`*`) are intentionally
 * NOT escaped — they're common in legitimate identifiers and a single line of
 * markdown can't inject cross-line instructions; malicious TEXT content (vs
 * structure) is defended by bundle signing, not by escaping.
 */
export function sanitizeName(raw: string | undefined): string {
  if (!raw) return '(unnamed)';
  // Collapse ALL whitespace (newlines/tabs included) to single spaces so the
  // name can never break out of its single catalog line, then hard-cap length.
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '(unnamed)';
  return s.length > MAX_SKILL_NAME_CHARS ? `${s.slice(0, MAX_SKILL_NAME_CHARS)}…` : s;
}

/**
 * Build a bounded catalog summary of MCP-visible skills.
 *
 * Output shape:
 *
 * ```
 * Available skills (read the `skill://index.json` resource for each skill's `SKILL.md` URI):
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
export function buildSkillsCatalogSummary(
  skillRegistry: SkillRegistryInterface | undefined,
  options: SkillsCatalogSummaryOptions = {},
): string {
  const skills = listedSkills(skillRegistry, options);
  if (skills.length === 0) return '';

  const pointers = pointersFor(options);
  const lines: string[] = [pointers.header, ''];

  let truncated = false;
  let shownCount = 0;
  let charCount = lines.join('\n').length;
  // Reserve room for the truncation footer up-front so the final string
  // (including the footer) never exceeds MAX_SKILL_CATALOG_CHARS.
  const effectiveCap = MAX_SKILL_CATALOG_CHARS - TRUNCATION_FOOTER_RESERVE;
  for (const skill of skills) {
    const name = sanitizeName(skill.metadata.name);
    const description = sanitizeDescription(skill.getDescription());
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
      `_(catalog truncated — showing ${shownCount} of ${skills.length} skills; ${pointers.truncationHint})_`,
    );
  }

  return lines.join('\n');
}

/** The `'compact'` line: how many skills there are and where to read them. Empty when there are none. */
function buildCompactSkillsLine(
  skillRegistry: SkillRegistryInterface | undefined,
  options: SkillsCatalogSummaryOptions,
): string {
  const count = listedSkills(skillRegistry, options).length;
  // A read-only external provider serves skills the registry does not hold, so none can be counted.
  const servesExternalSkills = skillRegistry?.getExternalProvider()?.isReadOnly() === true;
  if (count === 0 && !servesExternalSkills) return '';
  let skills = count === 1 ? '1 skill' : `${count} skills`;
  if (servesExternalSkills) skills = 'skills';
  return `This server has ${skills}: ${pointersFor(options).compact}`;
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
 * - `'compact'` (default): user + channel + one line counting the skills, no line without skills.
 * - `'append'`: user + channel + catalog, in that order.
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

  const summaryOptions: SkillsCatalogSummaryOptions = {
    mcpResources: options.mcpResources,
    skills: options.skills,
    pointers: options.pointers,
  };
  if (policy === 'compact') {
    return joinSections([user, channel, buildCompactSkillsLine(options.skillRegistry, summaryOptions)]);
  }

  const catalog = buildSkillsCatalogSummary(options.skillRegistry, summaryOptions);
  if (policy === 'prepend') {
    return joinSections([catalog, channel, user]);
  }
  // 'append' (and the 'replace'-with-empty-user fallback)
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

/** The scope surface instruction composition reads. */
export type InstructionsScope = Pick<
  ScopeEntry,
  | 'metadata'
  | 'skills'
  | 'logger'
  | 'runFlowForOutput'
  | 'authoritiesEngine'
  | 'authoritiesContextBuilder'
  | 'authoritiesScopeMapping'
> & {
  readonly channels?: ChannelRegistryLike;
  /** Where a plugin's {@link SkillCatalogSource} is provided, under `SkillCatalogSourceToken`. */
  readonly providers?: ScopeEntry['providers'];
};

export interface CallerInstructionsOptions {
  /** The caller's MCP handler context (`{ authInfo }`); omit inside a request flow, which already carries it. */
  ctx?: { authInfo?: unknown };
  /** Append the SEP-2640 `skill://…/SKILL.md` hints when `skillsConfig.sep2640InInstructions` is on. */
  skillUriHints?: boolean;
  /** The caller's `clientInfo.name`, whose `clients` profile may set `instructions`. */
  clientName?: string;
}

/** The `skillsConfig.injectInstructions` policy, unless the caller's `clients` profile sets `instructions`. */
function instructionsPolicyFor(
  scope: InstructionsScope,
  clientName: string | undefined,
): InjectInstructionsPolicy | undefined {
  const profiled = resolveClientProfile(scope.metadata.clients, clientName)?.instructions;
  if (profiled === 'full') return 'append';
  return profiled ?? scope.metadata.skillsConfig?.injectInstructions;
}

/**
 * Compose the `initialize` instructions for one caller: server instructions, channel hints and the
 * compact skills line or skill catalog (plus the SEP-2640 hints when asked), per `skillsConfig.injectInstructions`.
 *
 * The line, catalog and hints only count or name the MCP-visible skills the skill authorities and the hookable
 * `skills:filter` flow let this caller see, the same skills `skills/list` returns. The filter only
 * runs when the instructions would list a skill. If it fails, the skills are left out rather than
 * failing the handshake. With nothing filtering, the result equals {@link composeInitializeInstructions}.
 */
export async function composeCallerInstructions(
  scope: InstructionsScope,
  options: CallerInstructionsOptions = {},
): Promise<string> {
  const skillsConfig = scope.metadata.skillsConfig;
  // A plugin's runtime skills (a Skilled OpenAPI bundle) are registered once it is ready; wait, so the
  // instructions count and list them, and point to the plugin's tools if it serves skills through them (#1067).
  const source = findSkillCatalogSource(scope);
  if (source) {
    try {
      await source.ready();
    } catch (error) {
      scope.logger.warn('initialize instructions: a skill source failed to load; composed without its skills', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const composeOptions: ComposeOptions = {
    userInstructions: scope.metadata.instructions,
    channelInstructions: buildChannelInstructions(scope.channels),
    skillRegistry: scope.skills,
    policy: instructionsPolicyFor(scope, options.clientName),
    mcpResources: skillsConfig?.mcpResources,
    pointers: source?.pointers,
  };
  const withUriHints = options.skillUriHints === true && skillUriHintsEnabled(scope);
  const listsSkills = withUriHints || includesSkillCatalog(composeOptions);

  let skills: SkillEntry[] = [];
  if (listsSkills) {
    try {
      skills = await skillsVisibleTo(scope, options.ctx);
    } catch (error) {
      scope.logger.warn('initialize instructions: left the skills out, the skills:filter flow failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const composed = composeInitializeInstructions({ ...composeOptions, skills });
  const uriHints = withUriHints ? buildSkillUriHints(skills, scope.skills?.getSep2640InstructionUris?.() ?? []) : '';
  return [composed, uriHints].filter((section) => section.length > 0).join('\n\n---\n\n');
}

/**
 * SEP-2640 §Discovery — the opt-in `instructions` block listing each given skill's
 * `skill://<path>/SKILL.md` URI, plus any extra URIs registered on the registry.
 * Empty when there are no skills.
 */
function buildSkillUriHints(skills: readonly SkillEntry[], extraUris: readonly string[] = []): string {
  if (skills.length === 0) return '';
  const lines = ['Available skills (load via resources/read):'];
  for (const skill of skills) {
    lines.push(`- skill://${skill.getSkillPath()}/SKILL.md — ${skill.getDescription()}`);
  }
  for (const extra of extraUris) {
    lines.push(`- ${extra}`);
  }
  return lines.join('\n');
}

/**
 * Whether the SEP-2640 URI hints are sent: `skillsConfig.sep2640InInstructions` is on, the
 * `skill://` resources are served (`mcpResources` is not false), and `injectInstructions: 'replace'`
 * with non-empty server instructions does not require those to be sent alone.
 */
function skillUriHintsEnabled(scope: InstructionsScope): boolean {
  const skillsConfig = scope.metadata.skillsConfig;
  if (!skillsConfig?.sep2640InInstructions || skillsConfig.mcpResources === false) return false;
  const serverInstructions = (scope.metadata.instructions ?? '').trim();
  return !(skillsConfig.injectInstructions === 'replace' && serverInstructions.length > 0);
}

/** Whether {@link composeInitializeInstructions} counts or lists skills under these options. */
function includesSkillCatalog(options: ComposeOptions): boolean {
  const policy = options.policy ?? DEFAULT_POLICY;
  if (policy === 'off') return false;
  return !(policy === 'replace' && (options.userInstructions ?? '').trim().length > 0);
}

/** The MCP-visible skills the skill authorities and the `skills:filter` flow let the caller see. */
async function skillsVisibleTo(scope: InstructionsScope, ctx?: { authInfo?: unknown }): Promise<SkillEntry[]> {
  const visible = scope.skills?.getSkills({ visibility: 'mcp' }) ?? [];
  if (visible.length === 0) return [];
  const authInfo = (ctx?.authInfo ?? {}) as Record<string, unknown>;
  const authorized = await filterSkillsByAuthorities(scope, visible, authInfo);
  // Instructions go to MCP clients only (initialize, server/discover), so they list what an MCP
  // client (or a CLI build's in-process client) may reach.
  return filterServableSkills(scope, authorized, ctx, callSurfaceOf(ctx) ?? mcpRequestSurface(scope));
}

function joinSections(sections: Array<string | undefined>): string {
  return sections
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('\n\n---\n\n');
}
