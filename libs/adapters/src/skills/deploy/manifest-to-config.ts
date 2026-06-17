// file: libs/adapters/src/skills/deploy/manifest-to-config.ts
//
// Deterministic projection of a parsed `frontmcp.deploy.yaml` (`DeployManifest`)
// onto FrontMCP config inputs — the "boot a server straight from the manifest"
// keystone (#6). This is a PURE function (no I/O, no spec fetching): it maps the
// declarative manifest fields onto the exact shapes `@FrontMcp(...)` /
// `createEdgeMcp(...)` accept, and normalizes the OpenAPI `specs` inventory into
// a typed list ready to mount.
//
// What this does NOT do (intentionally — those are runtime/async steps that
// build on this projection):
//   - fetch/parse the OpenAPI specs and synthesize tools (use OpenapiAdapter
//     with each NormalizedSpecSource), or
//   - load skill files from `skillsSource` (use FilesystemSkillsSource), or
//   - provision Cloudflare `bindings`/`secrets` (a deploy-time concern).

import type { DeployManifest } from './deploy-manifest.schema';

/** A single OpenAPI spec to mount, with defaults resolved. */
export interface NormalizedSpecSource {
  /** Stable, URI-safe spec id. For a bare string ref, the filename stem. */
  id: string;
  /** Local path or HTTPS URL to the spec document. */
  spec: string;
  /** Optional base URL override for outbound operation calls. */
  baseUrl?: string;
  /** AgentScript binding namespace (defaults to `id`). */
  bindingName: string;
}

/** Skill loading + visibility derived from `manifest.skills`. */
export interface ManifestSkillsConfig {
  /** Directory the worker auto-discovers `SKILL.md`s from. */
  source: string;
  /** Skill ids pre-loaded into every `execute()` regardless of agent selection. */
  alwaysLoad?: string[];
  /** Deploy-time tag filter (include/exclude). */
  tags?: { include?: string[]; exclude?: string[] };
}

/** FrontMCP config inputs projected from a `DeployManifest`. */
export interface ManifestFrontMcpConfig {
  /** Server identity — spread straight into `@FrontMcp({ info })` / `createEdgeMcp`. */
  info: { name: string; version: string; title?: string };
  /** Top-level server instructions (injected at `initialize`), if declared. */
  instructions?: string;
  /**
   * `skillsConfig` for the SDK: skills serving enabled, with the instruction
   * merge policy. `injectInstructions: 'append'` matches the manifest contract
   * (the skill-catalog summary follows the server instructions).
   */
  skillsConfig: { enabled: true; injectInstructions: 'off' | 'append' | 'prepend' | 'replace' };
  /** Skill loading config (source dir, always-load ids, tag filter). */
  skills: ManifestSkillsConfig;
  /**
   * OpenAPI specs to mount as tools (normalized). Empty when `manifest.specs`
   * is a single directory string — see {@link ManifestFrontMcpConfig.specsDir}.
   */
  specs: NormalizedSpecSource[];
  /** A directory to auto-discover specs from, when `manifest.specs` is a dir string. */
  specsDir?: string;
}

/** Filename stem (no dir, no `.yaml`/`.yml`/`.json` extension, no query/hash). */
function specStem(ref: string): string {
  const noQuery = ref.split('?')[0].split('#')[0];
  const base = noQuery.split('/').pop() ?? noQuery;
  const stem = base.replace(/\.(ya?ml|json)$/i, '');
  // Keep it URI-safe (spec ids key resource URIs / binding namespaces).
  const safe = (stem || base).replace(/[^a-zA-Z0-9_.-]/g, '-');
  return safe || 'spec';
}

/** Normalize one `specSource` (bare string or detail object) with defaults. */
function normalizeSpec(source: string | { id: string; spec: string; baseUrl?: string; bindingName?: string }): NormalizedSpecSource {
  if (typeof source === 'string') {
    const id = specStem(source);
    return { id, spec: source, bindingName: id };
  }
  return {
    id: source.id,
    spec: source.spec,
    baseUrl: source.baseUrl,
    bindingName: source.bindingName ?? source.id,
  };
}

/**
 * Project a parsed {@link DeployManifest} onto FrontMCP config inputs.
 *
 * @param manifest a manifest already validated by `deployManifestSchema`
 *   (apply environment overlays first via `applyEnvironmentOverlay` if needed).
 */
export function buildFrontMcpConfigFromManifest(manifest: DeployManifest): ManifestFrontMcpConfig {
  const info: ManifestFrontMcpConfig['info'] = {
    name: manifest.server.info.name,
    version: manifest.server.info.version,
    ...(manifest.server.info.title !== undefined ? { title: manifest.server.info.title } : {}),
  };

  const skills: ManifestSkillsConfig = {
    source: manifest.skills.source,
    ...(manifest.skills.alwaysLoad ? { alwaysLoad: manifest.skills.alwaysLoad } : {}),
    ...(manifest.skills.tags ? { tags: manifest.skills.tags } : {}),
  };

  // `manifest.specs` is either a single directory (auto-discover) or an explicit
  // list of bare strings / detail objects.
  let specs: NormalizedSpecSource[] = [];
  let specsDir: string | undefined;
  if (typeof manifest.specs === 'string') {
    specsDir = manifest.specs;
  } else {
    specs = manifest.specs.map(normalizeSpec);
    // Derived ids key resource URIs / binding namespaces, so a collision (e.g.
    // two bare refs whose filename stems collapse to the same id) would silently
    // clobber one spec's binding — fail loudly instead.
    const seen = new Set<string>();
    for (const s of specs) {
      if (seen.has(s.id)) {
        throw new Error(
          `manifest specs: duplicate spec id "${s.id}" (derived from the filename stem). ` +
            `Give the colliding spec an explicit { id } in frontmcp.deploy.yaml.`,
        );
      }
      seen.add(s.id);
    }
  }

  return {
    info,
    ...(manifest.server.instructions !== undefined ? { instructions: manifest.server.instructions } : {}),
    skillsConfig: { enabled: true, injectInstructions: 'append' },
    skills,
    specs,
    ...(specsDir !== undefined ? { specsDir } : {}),
  };
}
