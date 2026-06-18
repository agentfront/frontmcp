// file: plugins/plugin-skilled-openapi/src/executor/execute-skill-action.ts
//
// Shared "run one skilled-OpenAPI operation" path: resolve → authorize →
// validate input → outbound HTTPS (vault creds injected) → validate output →
// structured envelope. The enclave codecall (`run_workflow`) calls this once per
// `callTool(actionId, input)` so a sandboxed AgentScript orchestrates the SAME
// authorized/validated operations a single direct call would run. Failures are
// returned as `{ ok:false, error }` envelopes — they never throw.

import { type BundleStore, type SkillAuditWriter } from '@frontmcp/adapters/skills';
import type { FrontMcpLogger } from '@frontmcp/sdk';

import { executeOperation, type OpenApiRuntimeDeps } from './openapi-runtime';
import { getCompiledOpSchemas } from './schema-cache';
import { type HiddenOpEntry } from '../registry/hidden-op.registry';
import { type AuthorityGuard } from '../security/authority-guard';

/** Structured result envelope (the structured envelope the skill-action executor returns). */
export interface SkillActionResult {
  ok: boolean;
  status: number;
  data?: unknown;
  contentType?: string;
  error?: string;
}

/** Dependencies the shared executor needs — all resolved from DI by the caller. */
export interface SkillActionDeps {
  config: { outbound: OpenApiRuntimeDeps['outbound'] };
  resolver: { resolve: OpenApiRuntimeDeps['resolver']['resolve'] };
  guard: AuthorityGuard;
  bundleStore: BundleStore;
  logger: FrontMcpLogger;
  /** Opt-in tamper-evident audit (when `skillsConfig.audit.enabled`). */
  audit?: { writer: SkillAuditWriter; subject: string };
}

/** Compact one-line render of zod issues for the envelope's `error` string. */
function formatZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  if (!issues.length) return 'unspecified validation error';
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}

/**
 * Execute a single resolved skill action. `entry` is the pinned operation
 * descriptor (resolved via `HiddenOpRegistry.get`/`getByActionId`); `authInfo`
 * is the caller's verified auth context (checked against the op's required
 * authorities).
 */
export async function executeSkillAction(args: {
  entry: HiddenOpEntry;
  input: Record<string, unknown>;
  authInfo: unknown;
  deps: SkillActionDeps;
}): Promise<SkillActionResult> {
  const { entry, input, authInfo, deps } = args;
  const { config, resolver, guard, bundleStore, logger, audit } = deps;

  // Audit context shared by every write; writes are detached (a slow/failing
  // audit backend must never block or fail the caller).
  const auditCtx = {
    subject: audit?.subject ?? 'anonymous',
    skillId: entry.skillId,
    actionId: entry.op.operationId,
    bundleId: entry.bundleId,
    bundleVersion: entry.bundleVersion,
    input: input ?? {},
  };
  const detach = (op: Promise<void> | undefined, phase: string): void => {
    op?.catch((e) => logger.warn(`[skill-audit] ${phase} write failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  // 1) Authority check (skill-level + op-level merged).
  const authResult = await guard.check({
    policy: entry.op.requiredAuthorities,
    authInfo: (authInfo ?? {}) as never as Parameters<AuthorityGuard['check']>[0]['authInfo'],
    input: input ?? {},
  });
  if (!authResult.granted) {
    detach(
      audit?.writer.writeAuthorityFail(auditCtx, { reason: authResult.deniedBy ?? 'policy not satisfied' }),
      'authority-fail',
    );
    return { ok: false, status: 0, error: `authority denied: ${authResult.deniedBy ?? 'policy not satisfied'}` };
  }
  detach(audit?.writer.writeAuthorityPass(auditCtx), 'authority-pass');

  // 2) Compile (cached) input/output schemas, then validate input strictly.
  const schemas = getCompiledOpSchemas({
    bundleVersion: entry.bundleVersion,
    operationId: entry.op.operationId,
    inputSchema: entry.op.inputSchema,
    outputSchema: entry.op.outputSchema,
  });
  const inputParse = schemas.input.safeParse(input ?? {});
  if (!inputParse.success) {
    return { ok: false, status: 0, error: `input validation failed: ${formatZodIssues(inputParse.error.issues)}` };
  }

  // 3) Allowed hosts: pinned service first, union'd with the active bundle's.
  const allowedHosts = new Set<string>();
  try {
    allowedHosts.add(new URL(entry.service.baseUrl).hostname.toLowerCase());
  } catch {
    // malformed pinned service URL — SSRF guard will reject in executeOperation
  }
  const bundle = bundleStore.current();
  if (bundle) {
    for (const svc of bundle.services) {
      try {
        allowedHosts.add(new URL(svc.baseUrl).hostname.toLowerCase());
      } catch {
        // skip malformed
      }
    }
  }

  const runtimeDeps: OpenApiRuntimeDeps = {
    outbound: config.outbound,
    resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
    allowedHosts,
    logger,
  };

  // 4) Execute the outbound call.
  let result: Awaited<ReturnType<typeof executeOperation>>;
  try {
    result = await executeOperation({
      entry,
      bundleId: entry.bundleId,
      input: inputParse.data as Record<string, unknown>,
      deps: runtimeDeps,
    });
  } catch (e) {
    detach(audit?.writer.writeHttpCallFailure(auditCtx, { status: 0, error: e }), 'http-call-failure');
    throw e;
  }
  if (result.ok) {
    detach(audit?.writer.writeHttpCallSuccess(auditCtx, { status: result.status, output: result.data ?? null }), 'http-call-success');
  } else {
    detach(
      audit?.writer.writeHttpCallFailure(auditCtx, {
        status: result.status,
        error: result.error ?? `http call failed with status ${result.status}`,
      }),
      'http-call-failure',
    );
  }

  // 5) Validate JSON response against the op's output schema (errors pass through).
  const isJsonResponse = (result.contentType ?? '').toLowerCase().includes('application/json');
  if (result.ok && isJsonResponse && result.data !== undefined && result.data !== null) {
    const outputParse = schemas.output.safeParse(result.data);
    if (!outputParse.success) {
      return {
        ok: false,
        status: result.status,
        ...(result.contentType ? { contentType: result.contentType } : {}),
        error: `upstream response failed output schema: ${formatZodIssues(outputParse.error.issues)}`,
      };
    }
  }

  return {
    ok: result.ok,
    status: result.status,
    ...(result.data !== undefined && result.data !== null ? { data: result.data } : {}),
    ...(result.contentType ? { contentType: result.contentType } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}
