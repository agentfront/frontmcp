// file: libs/adapters/src/skills/openapi/compile-skilled-bundle.ts
//
// Compile a raw OpenAPI document + hand-authored skills (each referencing the
// `operationId`s it uses) into a skilled-OpenAPI **bundle** — the manifest the
// `search_skill` / `load_skill` / `run_workflow` runtime consumes.
//
// The connection between operationId ↔ skill lives here: an operation is
// included ONLY if at least one skill references its `operationId`. So uploading
// a full OpenAPI exposes nothing until a skill's markdown names the operations
// it serves. The per-operation input/output JSON schemas are derived live from
// the OpenAPI (via `mcp-from-openapi`'s `OpenAPIToolGenerator`), so they stay in
// sync with the spec.
//
// Worker-safe: parsing/generation only — NO enclave (that's the execute leg).
// This is the in-repo (first-party) compiler; the SaaS control plane will reuse
// it to produce signed manifests.

import { OpenAPIToolGenerator, type McpOpenAPITool } from 'mcp-from-openapi';

/** A hand-authored skill that declares which OpenAPI operations it serves. */
export interface SkillOpenApiRef {
  /** Stable skill id (kebab-case). */
  id: string;
  /** Human-readable skill name. */
  name: string;
  /** One-line description (used for search ranking). */
  description: string;
  /** Markdown instructions for performing the skill. */
  instructions: string;
  /** OpenAPI `operationId`s this skill exposes. Operations not referenced by any skill are dropped. */
  operationIds: string[];
  /** Optional tags (search facets). */
  tags?: string[];
}

export interface CompileSkilledBundleOptions {
  /** Stable bundle id (e.g. `acme:billing`). */
  bundleId: string;
  /** Bundle version (e.g. `1.0.0`). */
  version: string;
  /** Service id the operations bind to. Default `'api'`. */
  serviceId?: string;
  /**
   * Base URL for the service. Defaults to the OpenAPI doc's first `servers[].url`.
   * Required if the document declares no servers.
   */
  baseUrl?: string;
  /** ISO timestamp for `generatedAt`. Defaults to now. */
  generatedAt?: string;
  /** Auth binding for the service. Default `{ kind: 'none' }`. */
  authBinding?: Record<string, unknown>;
  /** Digest of the source inputs (provenance). Defaults to a zero digest. */
  sourceDigest?: string;
}

/** Minimal structural view of the parts of an OpenAPI doc we read directly. */
interface OpenApiDocLike {
  servers?: Array<{ url?: string }>;
}

/** A compiled skilled-OpenAPI bundle (schemaVersion 1) — validated downstream by `parseOverlay`. */
export interface CompiledSkilledBundle {
  schemaVersion: 1;
  bundleId: string;
  version: string;
  generatedAt: string;
  sourceDigest: string;
  services: Array<{ id: string; baseUrl: string; description?: string }>;
  authBindings: Record<string, Record<string, unknown>>;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    tags: string[];
    operationIds: string[];
  }>;
  operations: Record<
    string,
    {
      operationId: string;
      serviceId: string;
      httpMethod: string;
      pathTemplate: string;
      summary?: string;
      inputSchema: unknown;
      outputSchema: unknown;
      mapper: unknown[];
      authBindingRef: string;
    }
  >;
}

/**
 * Compile `(openapi, skills)` → a skilled-OpenAPI bundle. Throws if a skill
 * references an `operationId` the OpenAPI doesn't define (fail-fast on drift).
 */
export async function compileSkilledBundleFromOpenApi(
  openapi: object,
  skills: SkillOpenApiRef[],
  options: CompileSkilledBundleOptions,
): Promise<CompiledSkilledBundle> {
  const serviceId = options.serviceId ?? 'api';
  const baseUrl = options.baseUrl ?? (openapi as OpenApiDocLike).servers?.[0]?.url;
  if (!baseUrl) {
    throw new Error('compileSkilledBundleFromOpenApi: no baseUrl — pass options.baseUrl or declare servers[] in the OpenAPI doc.');
  }

  // Parse the OpenAPI → tools (operations) with live input/output JSON schemas.
  const generator = await OpenAPIToolGenerator.fromJSON(openapi);
  const tools = await generator.generateTools();

  // Index by operationId — the link between a skill's markdown refs and the spec.
  const byOperationId = new Map<string, McpOpenAPITool>();
  for (const tool of tools) {
    const opId = tool.metadata.operationId;
    if (opId) byOperationId.set(opId, tool);
  }

  // Build operations ONLY for ids referenced by ≥1 skill ("exposed only if in a skill").
  const referenced = new Set<string>();
  for (const skill of skills) for (const opId of skill.operationIds) referenced.add(opId);

  const operations: CompiledSkilledBundle['operations'] = {};
  for (const opId of referenced) {
    const tool = byOperationId.get(opId);
    if (!tool) {
      throw new Error(`compileSkilledBundleFromOpenApi: operationId "${opId}" is referenced by a skill but not defined in the OpenAPI document.`);
    }
    operations[opId] = {
      operationId: opId,
      serviceId,
      httpMethod: tool.metadata.method.toUpperCase(),
      pathTemplate: tool.metadata.path,
      summary: tool.metadata.operationSummary ?? tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? { type: 'object' },
      mapper: tool.mapper as unknown[],
      authBindingRef: 'default',
    };
  }

  return {
    schemaVersion: 1,
    bundleId: options.bundleId,
    version: options.version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceDigest: options.sourceDigest ?? '0'.repeat(64),
    services: [{ id: serviceId, baseUrl }],
    authBindings: { default: options.authBinding ?? { kind: 'none' } },
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      tags: s.tags ?? [],
      operationIds: s.operationIds,
    })),
    operations,
  };
}
