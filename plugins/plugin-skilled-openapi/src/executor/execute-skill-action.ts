// file: plugins/plugin-skilled-openapi/src/executor/execute-skill-action.ts
//
// Shared "run one skilled-OpenAPI operation" path: resolve → authorize →
// validate input → confirm (when `confirm` names it) → outbound HTTPS (vault
// creds injected) → validate output → structured envelope. The enclave
// codecall (`run_workflow`) calls this once per `callTool(actionId, input)` so
// a sandboxed AgentScript orchestrates the SAME authorized/validated
// operations a single direct call would run. Failures are
// returned as `{ ok:false, error }` envelopes, except a caller credential that
// isn't connected, which throws `ToolCredentialsRequiredError`.

import { type SkillAuditWriter } from '@frontmcp/adapters/skills';
import type { AuthoritiesResult } from '@frontmcp/auth';
import type { FrontMcpLogger } from '@frontmcp/sdk';

import { type HiddenOpEntry, type OperationListings } from '../registry/hidden-op.registry';
import { type AuthorityGuard, type UnprotectedOpsPolicy } from '../security/authority-guard';
import { type VisibleListings } from '../security/skill-visibility';
import { type ConfirmOptions } from '../skilled-openapi.types';
import { needsConfirmation, type ConfirmAction } from './action-confirmation';
import { unknownActionError } from './action-outcome';
import type { CallerAuthInfo } from './credential-resolver';
import { executeOperation, type OpenApiRuntimeDeps } from './openapi-runtime';
import { getCompiledOpSchemas } from './schema-cache';

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
  config: {
    outbound: OpenApiRuntimeDeps['outbound'];
    /** Default-deny policy for ops with no required-authorities (C1/C3). */
    unprotectedOps: UnprotectedOpsPolicy;
    /** The actions that ask the user before their request. */
    confirm?: ConfirmOptions;
  };
  /** Decides, for an action `confirm` names, whether its request may be sent: the calling tool asks the user. */
  confirmAction: ConfirmAction;
  resolver: { resolve: OpenApiRuntimeDeps['resolver']['resolve'] };
  guard: AuthorityGuard;
  /** Which listings of an operation count for the caller: those whose skill the `skills:filter` flow shows them. */
  visibleListings: VisibleListings;
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

/** The listing a call runs under, and the guard's answer for it. */
export interface ActionAuthorization {
  entry: HiddenOpEntry;
  result: AuthoritiesResult;
  /** Set when `skills:filter` hides every skill listing the operation: the call is answered as an unknown action. */
  hidden?: true;
}

/** The decision of a call no `confirm` rule names: it runs without asking. */
const NO_CONFIRMATION_REQUIRED = { confirmation: 'not_required' } as const;

/** Why the audit log records a call denied because `skills:filter` hides every skill listing its operation. */
const HIDDEN_SKILLS_REASON = 'skills:filter hides every skill that lists the action';

/**
 * Authorize a call to an operation that one or more skills list. Only the
 * listings whose skill the `skills:filter` flow shows the caller count, as in
 * discovery, and the caller must satisfy the operation's rule and the
 * skill-level rule of at least one of them. The call runs, and is audited,
 * under the first listing that admits the caller; when none does, the first
 * visible listing's denial is returned, and when none is visible, a `hidden` one.
 */
export async function authorizeAction(args: {
  listings: OperationListings;
  visibleListings: VisibleListings;
  guard: AuthorityGuard;
  unprotectedOps: UnprotectedOpsPolicy;
  authInfo: unknown;
  input: Record<string, unknown>;
}): Promise<ActionAuthorization> {
  const { listings, visibleListings, guard, unprotectedOps, authInfo, input } = args;
  const checkListing = (entry: HiddenOpEntry): Promise<AuthoritiesResult> =>
    guard.check({
      policy: entry.op.requiredAuthorities,
      skillPolicy: entry.skillRequiredAuthorities,
      isPublic: entry.op.public,
      unprotectedOps,
      authInfo: (authInfo ?? {}) as Parameters<AuthorityGuard['check']>[0]['authInfo'],
      input,
    });

  const [firstListing, ...otherListings] = await visibleListings(listings);
  if (!firstListing) {
    return {
      entry: listings[0],
      result: { granted: false, deniedBy: HIDDEN_SKILLS_REASON, evaluatedPolicies: [] },
      hidden: true,
    };
  }
  const firstResult = await checkListing(firstListing);
  if (firstResult.granted) return { entry: firstListing, result: firstResult };
  for (const entry of otherListings) {
    const result = await checkListing(entry);
    if (result.granted) return { entry, result };
  }
  return { entry: firstListing, result: firstResult };
}

/**
 * Execute a single resolved skill action. `listings` are the pinned entries of
 * every skill that lists the operation (`HiddenOpRegistry.get`/`listingsOf`);
 * `authInfo` is the caller's verified auth context (see {@link authorizeAction}).
 */
export async function executeSkillAction(args: {
  listings: OperationListings;
  input: Record<string, unknown>;
  authInfo: CallerAuthInfo;
  /** Aborts the request in flight, and keeps one from starting, once the call it belongs to has ended. */
  signal?: AbortSignal;
  deps: SkillActionDeps;
}): Promise<SkillActionResult> {
  const { listings, input, authInfo, signal, deps } = args;
  const { config, resolver, guard, visibleListings, logger, audit } = deps;

  // 1) Authority check: the operation's rule and the rule of one listing skill
  //    the caller may see must both grant; a policy-less op is allowed/denied
  //    per `unprotectedOps` (C1/C2/C3).
  const authorization = await authorizeAction({
    listings,
    visibleListings,
    guard,
    unprotectedOps: config.unprotectedOps,
    authInfo,
    input: input ?? {},
  });
  const { entry, result: authResult } = authorization;

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

  if (!authResult.granted) {
    const reason = authResult.deniedBy ?? 'policy not satisfied';
    detach(audit?.writer.writeAuthorityFail(auditCtx, { reason }), 'authority-fail');
    const error = authorization.hidden ? unknownActionError(entry.op.operationId) : `authority denied: ${reason}`;
    return { ok: false, status: 0, error };
  }
  detach(audit?.writer.writeAuthorityPass(auditCtx), 'authority-pass');

  // 2) Compile (cached) input/output schemas, then validate input strictly.
  const schemas = getCompiledOpSchemas(entry.op);
  const inputParse = schemas.input.safeParse(input ?? {});
  if (!inputParse.success) {
    const error = `input validation failed: ${formatZodIssues(inputParse.error.issues)}`;
    detach(audit?.writer.writeHttpCallFailure(auditCtx, { status: 0, error }), 'http-call-failure');
    return { ok: false, status: 0, error };
  }
  const validInput = inputParse.data as Record<string, unknown>;

  // 3) An action the `confirm` option names asks the user before its request; a refusal sends nothing.
  const decision = needsConfirmation(config.confirm, listings)
    ? await deps.confirmAction({ entry, input: validInput })
    : NO_CONFIRMATION_REQUIRED;
  const decidedAuditCtx = { ...auditCtx, confirmation: decision.confirmation };
  if ('refusal' in decision) {
    const error = decision.refusal;
    detach(audit?.writer.writeHttpCallFailure(decidedAuditCtx, { status: 0, error }), 'http-call-failure');
    return { ok: false, status: 0, error };
  }

  // 4) Allowed hosts: ONLY the single service this op is bound to (B3).
  //    The credential injected below is the op's per-service vault credential;
  //    unioning every bundle service's host (the prior behavior) meant a
  //    credential for service A could egress to service B if a crafted input
  //    ever steered the request URL there. Least-privilege: the SSRF allowlist
  //    is exactly the one host whose credential we are about to attach.
  const allowedHosts = new Set<string>();
  try {
    allowedHosts.add(new URL(entry.service.baseUrl).hostname.toLowerCase());
  } catch {
    // malformed pinned service URL — SSRF guard will reject in executeOperation
  }

  const runtimeDeps: OpenApiRuntimeDeps = {
    outbound: config.outbound,
    resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
    allowedHosts,
    logger,
  };

  // 5) Execute the outbound call.
  let result: Awaited<ReturnType<typeof executeOperation>>;
  try {
    result = await executeOperation({
      entry,
      bundleId: entry.bundleId,
      input: validInput,
      authInfo,
      signal,
      deps: runtimeDeps,
    });
  } catch (e) {
    detach(audit?.writer.writeHttpCallFailure(decidedAuditCtx, { status: 0, error: e }), 'http-call-failure');
    throw e;
  }
  if (!result.ok) {
    detach(
      audit?.writer.writeHttpCallFailure(decidedAuditCtx, {
        status: result.status,
        error: result.error ?? `http call failed with status ${result.status}`,
      }),
      'http-call-failure',
    );
  }

  // 6) Validate JSON response against the op's output schema; the audit records the outcome the caller gets.
  const isJsonResponse = (result.contentType ?? '').toLowerCase().includes('application/json');
  if (result.ok && isJsonResponse && result.data !== undefined && result.data !== null) {
    const outputParse = schemas.output.safeParse(result.data);
    if (!outputParse.success) {
      const error = `upstream response failed output schema: ${formatZodIssues(outputParse.error.issues)}`;
      detach(
        audit?.writer.writeHttpCallFailure(decidedAuditCtx, { status: result.status, error }),
        'http-call-failure',
      );
      return {
        ok: false,
        status: result.status,
        ...(result.contentType ? { contentType: result.contentType } : {}),
        error,
      };
    }
  }
  if (result.ok) {
    detach(
      audit?.writer.writeHttpCallSuccess(decidedAuditCtx, { status: result.status, output: result.data ?? null }),
      'http-call-success',
    );
  }

  return {
    ok: result.ok,
    status: result.status,
    ...(result.data !== undefined && result.data !== null ? { data: result.data } : {}),
    ...(result.contentType ? { contentType: result.contentType } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}
