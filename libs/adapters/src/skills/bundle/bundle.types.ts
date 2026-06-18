// file: libs/adapters/src/skills/bundle/bundle.types.ts

import type { SkillAction } from '@frontmcp/sdk';

import type { ParameterMapper } from '../../openapi';

/** HTTP methods we accept in v1.2. Multipart, SSE, websockets are out of scope. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** ABAC/RBAC policy carried by skills/ops. Loose at the boundary; libs/auth interprets. */
export type AuthoritiesPolicy = Record<string, unknown>;

/** Auth binding that the executor resolves to a real credential at call time. */
export type AuthBinding =
  | { kind: 'none' }
  | { kind: 'bearer'; vaultRef: string; passthroughCallerToken?: boolean }
  | { kind: 'apiKey'; in: 'header' | 'query'; name: string; vaultRef: string }
  | { kind: 'oauth2'; flow: 'client_credentials'; vaultRef: string };

/** Service descriptor — one per microservice referenced by the bundle. */
export interface ServiceDescriptor {
  /** Stable id (e.g. "billing"). Referenced by `OperationDescriptor.serviceId`. */
  id: string;
  /** Resolved server URL (no trailing slash). */
  baseUrl: string;
  /** Optional human-readable description. */
  description?: string;
}

/**
 * One executable operation derived from an OpenAPI `operationId`. The MCP client
 * never sees these directly — they are invokable only through the plugin's
 * `run_workflow` meta-tool, whose sandboxed `callTool(actionId, …)` resolves to
 * one of these.
 *
 * The descriptor is shaped so it can be projected onto an `McpOpenAPITool` for
 * reuse of `@frontmcp/adapters/openapi`'s `buildRequest` / `parseResponse`
 * runtime helpers — the SaaS analyzer ships the `mapper` array so the plugin
 * doesn't need to re-derive parameter locations from a raw OpenAPI spec.
 */
export interface OperationDescriptor {
  /** Stable identifier within the bundle (matches OpenAPI operationId). */
  operationId: string;
  /** Service this op lives in. Must match a `ServiceDescriptor.id`. */
  serviceId: string;
  /** HTTP method. */
  httpMethod: HttpMethod;
  /** Path template, e.g. "/v1/customers/{id}/invoices". */
  pathTemplate: string;
  /**
   * JSON Schema (Draft 2020-12) for the action's input — flat key/value map
   * matching the inputs that `mapper[].inputKey` references.
   */
  inputSchema: Record<string, unknown>;
  /** JSON Schema for the response body. */
  outputSchema: Record<string, unknown>;
  /**
   * Parameter mapper produced by the SaaS analyzer at OpenAPI parse time —
   * tells the executor which input keys land in path / query / header / cookie /
   * body slots. Reused verbatim by `@frontmcp/adapters/openapi`'s buildRequest.
   */
  mapper: ParameterMapper[];
  /** AuthBinding key (`bundle.authBindings[ref]`). */
  authBindingRef: string;
  /** Optional ABAC policy required to invoke this op. */
  requiredAuthorities?: AuthoritiesPolicy;
  /** Optional override of the response cap (bytes). */
  maxResponseBytes?: number;
  /** Optional override of the per-op timeout (ms). */
  timeoutMs?: number;
  /** Human-readable summary surfaced in `load_skill` content. */
  summary?: string;
  description?: string;
}

/** A skill bundles a curated set of operations. */
export interface BundledSkill {
  /** Stable skill id (must be unique within the bundle). */
  id: string;
  /** Display name for the skill. */
  name: string;
  /** Short description. */
  description: string;
  /** Markdown instructions surfaced by `load_skill`. */
  instructions: string;
  /** Optional tags for filtering. */
  tags?: string[];
  /** Operation ids this skill exposes (must exist in `bundle.operations`). */
  operationIds: string[];
  /** Optional skill-level authorities (in addition to per-op). */
  requiredAuthorities?: AuthoritiesPolicy;
  /**
   * Other skill ids this skill depends on. Same field name as the
   * agentskills Skill Package Manifest. Resolved at apply time via
   * `resolveSkillLoadOrder` (libs/adapters/src/skills/dependency).
   */
  requires?: string[];
}

/** Detached signature envelope for the bundle. */
export interface BundleIntegrity {
  alg: 'RS256' | 'EdDSA';
  /** Stable id of the signing key, matched against `trustedKeys[].keyId`. */
  keyId: string;
  /** Base64url-encoded detached signature. */
  signature: string;
  /** Base64url-encoded canonical-bytes hash that was signed (sha256). */
  digest: string;
}

/** A fully-resolved, validated bundle ready to project into the registry. */
export interface ResolvedBundle {
  /** Wire-format version (currently 1). */
  schemaVersion: 1;
  /** Stable bundle identifier (customer slug + env). */
  bundleId: string;
  /** Monotonic version string used by clients to detect bundle swaps. */
  version: string;
  /** ISO timestamp the SaaS produced this bundle. */
  generatedAt: string;
  /** sha256 of the canonical OpenAPI source spec. */
  sourceDigest: string;
  /** All services this bundle covers. */
  services: ServiceDescriptor[];
  /** Reusable auth bindings keyed by ref string. */
  authBindings: Record<string, AuthBinding>;
  /** Skills declared by the bundle. */
  skills: BundledSkill[];
  /** All operations referenced by skills, keyed by `operationId`. */
  operations: Record<string, OperationDescriptor>;
  /** Optional integrity envelope. Required when plugin's requireSignature=true. */
  integrity?: BundleIntegrity;
}

/**
 * Convenience projection of a single skill's executable actions.
 *
 * Throws if any of the skill's `operationIds` is missing from `ops`. Silently
 * dropping unknown ids would let a malformed bundle apply with the skill's
 * advertised action list out of sync with what `run_workflow`'s `callTool` can
 * actually resolve, so the bundle apply path treats this as a hard failure that trips
 * the rollback.
 */
export function bundleSkillToActions(skill: BundledSkill, ops: Record<string, OperationDescriptor>): SkillAction[] {
  return skill.operationIds.map((opId) => {
    const op = ops[opId];
    if (!op) {
      throw new Error(`bundleSkillToActions: skill "${skill.id}" references unknown operationId "${opId}"`);
    }
    const action: SkillAction = {
      actionId: op.operationId,
      summary: op.summary ?? `${op.httpMethod} ${op.pathTemplate}`,
      ...(op.description !== undefined && { description: op.description }),
      inputJsonSchema: op.inputSchema,
      outputJsonSchema: op.outputSchema,
      ...(op.requiredAuthorities !== undefined && { requiredAuthorities: op.requiredAuthorities }),
    };
    return action;
  });
}
