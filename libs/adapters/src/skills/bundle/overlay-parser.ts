// file: plugins/plugin-skilled-openapi/src/bundle/overlay-parser.ts

import * as yaml from 'js-yaml';

import { crossValidate, resolvedBundleSchema, type ParsedBundle } from './bundle.schema';
import type { ResolvedBundle } from './bundle.types';

/**
 * Pragmatic overlay-parser for v1.2.
 *
 * The wire format is an OpenAPI Overlay (OAI 1.0/1.1) whose `info.x-frontmcp-bundle`
 * extension carries the fully resolved bundle metadata produced by the SaaS
 * analyzer. The plugin DOES NOT walk overlay JSONPath updates against the spec
 * itself — the SaaS has already done all OpenAPI resolution and emits a flat,
 * validated bundle object. The plugin simply:
 *
 *   1. Parses the overlay YAML/JSON
 *   2. Extracts `info.x-frontmcp-bundle`
 *   3. Validates structure with Zod (defense-in-depth)
 *   4. Cross-validates references (serviceId / authBindingRef / operationId)
 *
 * This intentionally avoids re-implementing OpenAPI spec parsing in-tree. A
 * future v1.3 may add a build-time mode that consumes raw OpenAPI + Overlay
 * directly when SaaS isn't in the loop.
 */

export type OverlayInput =
  | { kind: 'yaml'; content: string }
  | { kind: 'json'; content: string }
  | { kind: 'object'; content: unknown };

const OVERLAY_BUNDLE_KEY = 'x-frontmcp-bundle';

export class OverlayParseError extends Error {
  constructor(
    message: string,
    public readonly errors?: string[],
  ) {
    super(message);
    this.name = 'OverlayParseError';
  }
}

function parseRaw(input: OverlayInput): unknown {
  switch (input.kind) {
    case 'yaml':
      try {
        return yaml.load(input.content);
      } catch (e) {
        throw new OverlayParseError(`Overlay YAML parse failed: ${(e as Error).message}`);
      }
    case 'json':
      try {
        return JSON.parse(input.content);
      } catch (e) {
        throw new OverlayParseError(`Overlay JSON parse failed: ${(e as Error).message}`);
      }
    case 'object':
      return input.content;
  }
}

function extractBundle(overlay: unknown): unknown {
  if (overlay === null || typeof overlay !== 'object') {
    throw new OverlayParseError('Overlay root must be an object');
  }
  // Allow either `info.x-frontmcp-bundle` (overlay-style) or the bundle as the
  // overlay root itself (when sources hand us a plain bundle JSON).
  const root = overlay as Record<string, unknown>;
  if (OVERLAY_BUNDLE_KEY in root) {
    return root[OVERLAY_BUNDLE_KEY];
  }
  const info = root['info'];
  if (info && typeof info === 'object' && OVERLAY_BUNDLE_KEY in (info as Record<string, unknown>)) {
    return (info as Record<string, unknown>)[OVERLAY_BUNDLE_KEY];
  }
  // Fallback: treat the whole thing as a bare bundle (used by static-source
  // tests and the npm-source default export shape).
  if ('schemaVersion' in root && 'bundleId' in root) {
    return root;
  }
  throw new OverlayParseError(
    'Overlay does not contain `info.x-frontmcp-bundle` or a bare bundle object with schemaVersion + bundleId',
  );
}

/**
 * Parse and validate an overlay into a ResolvedBundle. Throws OverlayParseError
 * on any structural or cross-reference violation.
 */
export function parseOverlay(input: OverlayInput): ResolvedBundle {
  const raw = parseRaw(input);
  const bundleCandidate = extractBundle(raw);

  const result = resolvedBundleSchema.safeParse(bundleCandidate);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
    throw new OverlayParseError(`Bundle schema validation failed (${errors.length} issue(s))`, errors);
  }

  const cross = crossValidate(result.data);
  if (!cross.ok) {
    throw new OverlayParseError(
      `Bundle cross-reference validation failed (${cross.errors.length} issue(s))`,
      cross.errors,
    );
  }

  // After Zod parsing the shapes match `ResolvedBundle` exactly; the cast is
  // safe because resolvedBundleSchema is the structural source of truth.
  return result.data as unknown as ResolvedBundle;
}

/** Re-export for tests that want raw schema output. */
export type { ParsedBundle };
