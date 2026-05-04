// file: plugins/plugin-skilled-openapi/src/bundle/bundle.schema.ts
//
// Zod schemas that validate a parsed bundle (spec + overlay) at runtime.
// This is defense-in-depth — even after signature verification, treat every
// string as adversarial (CVE-2025-6514 lesson). The schemas:
//   - reject extra properties (`additionalProperties: false` equivalent)
//   - constrain types and lengths
//   - bound recursion (e.g. on JSON Schemas embedded in operations)
//   - reject path templates with `..`, shell metacharacters, etc.

import { z } from '@frontmcp/lazy-zod';

const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

const pathTemplateRegex = /^\/[^\s?#]*$/;
const FORBIDDEN_PATH_FRAGMENTS = ['..', '\\', '`', '$(', '${'];

const pathTemplateSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => pathTemplateRegex.test(v), {
    message: 'pathTemplate must start with `/` and contain no whitespace, `?`, or `#`',
  })
  .refine((v) => !FORBIDDEN_PATH_FRAGMENTS.some((bad) => v.includes(bad)), {
    message: 'pathTemplate contains a forbidden character or fragment (`..`, backtick, `$(`, etc.)',
  });

// JSON Schema is itself recursive — bound it loosely; the executor compiles with
// stricter rules (additionalProperties: false, recursion depth cap).
const jsonSchemaShape = z.record(z.string(), z.unknown());

const authoritiesPolicySchema = z.record(z.string(), z.unknown());

const authBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('bearer'),
      vaultRef: z.string().min(1).max(256),
      passthroughCallerToken: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('apiKey'),
      in: z.enum(['header', 'query']),
      name: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, 'apiKey name must match RFC 7230 token grammar'),
      vaultRef: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal('oauth2'),
      flow: z.literal('client_credentials'),
      vaultRef: z.string().min(1).max(256),
    })
    .strict(),
]);

const serviceDescriptorSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/, 'service id must be alphanumeric / `-` / `_`'),
    baseUrl: z.string().url().max(2048),
    description: z.string().max(4096).optional(),
  })
  .strict();

// ParameterMapper from `mcp-from-openapi`. Loose-typed at the boundary to
// avoid coupling the plugin to upstream package internals; the executor casts
// to the proper ParameterMapper[] when handing off to buildRequest.
const parameterMapperSchema = z
  .object({
    inputKey: z.string().min(1).max(256),
    type: z.enum(['path', 'query', 'header', 'cookie', 'body']),
    key: z.string().min(1).max(256),
    required: z.boolean().optional(),
    style: z.string().max(64).optional(),
    explode: z.boolean().optional(),
    serialization: z.record(z.string(), z.unknown()).optional(),
    security: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const operationDescriptorSchema = z
  .object({
    operationId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9_.\-:]+$/, 'operationId must be alphanumeric / `-` / `_` / `.` / `:`'),
    serviceId: z.string().min(1).max(128),
    httpMethod: httpMethodSchema,
    pathTemplate: pathTemplateSchema,
    inputSchema: jsonSchemaShape,
    outputSchema: jsonSchemaShape,
    mapper: z.array(parameterMapperSchema).max(256),
    authBindingRef: z.string().min(1).max(128),
    requiredAuthorities: authoritiesPolicySchema.optional(),
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024)
      .optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    summary: z.string().max(512).optional(),
    description: z.string().max(8192).optional(),
  })
  .strict();

const bundledSkillSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    name: z.string().min(1).max(256),
    description: z.string().max(2048),
    instructions: z.string().max(256 * 1024),
    tags: z.array(z.string().max(64)).max(64).optional(),
    operationIds: z.array(z.string().min(1).max(256)).min(0).max(2000),
    requiredAuthorities: authoritiesPolicySchema.optional(),
    /**
     * Other skill ids this skill depends on. Hosts that consume the bundle
     * register skills in dependency order; cycles and missing deps are caught
     * at apply time. Field name aligned with the agentskills Skill Package
     * Manifest proposal (https://github.com/agentskills/agentskills/discussions/210)
     * so bundles round-trip across runtimes without a schema bump.
     */
    requires: z.array(z.string().min(1).max(128)).max(64).optional(),
  })
  .strict();

const integritySchema = z
  .object({
    alg: z.enum(['RS256', 'EdDSA']),
    keyId: z.string().min(1).max(256),
    signature: z.string().min(1).max(8192),
    digest: z.string().min(1).max(256),
  })
  .strict();

export const resolvedBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    bundleId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9_.\-:]+$/),
    version: z.string().min(1).max(256),
    generatedAt: z
      .string()
      .min(1)
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'generatedAt must be ISO 8601 parsable' }),
    sourceDigest: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-fA-F0-9]+$/, 'sourceDigest must be a hex sha256'),
    services: z.array(serviceDescriptorSchema).min(1).max(64),
    authBindings: z.record(z.string().min(1).max(128), authBindingSchema),
    skills: z.array(bundledSkillSchema).max(1000),
    operations: z.record(z.string().min(1).max(256), operationDescriptorSchema),
    integrity: integritySchema.optional(),
  })
  .strict();

export type ParsedBundle = z.infer<typeof resolvedBundleSchema>;

/**
 * Cross-field validation: every operation's serviceId must reference a known
 * service, every operation's authBindingRef must reference a known binding,
 * every skill's operationIds must reference known operations.
 */
export function crossValidate(bundle: ParsedBundle): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const serviceIds = new Set(bundle.services.map((s) => s.id));
  const authRefs = new Set(Object.keys(bundle.authBindings));
  const opIds = new Set(Object.keys(bundle.operations));

  for (const [opId, op] of Object.entries(bundle.operations)) {
    if (op.operationId !== opId) {
      errors.push(`operation key "${opId}" does not match operationId "${op.operationId}"`);
    }
    if (!serviceIds.has(op.serviceId)) {
      errors.push(`operation "${opId}" references unknown service "${op.serviceId}"`);
    }
    if (!authRefs.has(op.authBindingRef)) {
      errors.push(`operation "${opId}" references unknown authBinding "${op.authBindingRef}"`);
    }
  }

  const seenSkillIds = new Set<string>();
  for (const skill of bundle.skills) {
    if (seenSkillIds.has(skill.id)) {
      errors.push(`duplicate skill id "${skill.id}"`);
    }
    seenSkillIds.add(skill.id);
    for (const opId of skill.operationIds) {
      if (!opIds.has(opId)) {
        errors.push(`skill "${skill.id}" references unknown operationId "${opId}"`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
