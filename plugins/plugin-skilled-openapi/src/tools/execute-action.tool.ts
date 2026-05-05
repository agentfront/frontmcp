// file: plugins/plugin-skilled-openapi/src/tools/execute-action.tool.ts

import { BundleStore, SkillAuditWriterToken, type SkillAuditWriter } from '@frontmcp/adapters/skills';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { executeOperation, type OpenApiRuntimeDeps } from '../executor/openapi-runtime';
import { getCompiledOpSchemas } from '../executor/schema-cache';
import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import {
  executeActionDescription,
  executeActionInputSchema,
  executeActionOutputSchema,
  type ExecuteActionInput,
  type ExecuteActionOutput,
} from './execute-action.schema';

@Tool({
  name: 'execute_action',
  description: executeActionDescription,
  inputSchema: executeActionInputSchema,
  outputSchema: executeActionOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
})
export default class ExecuteActionTool extends ToolContext {
  async execute(input: ExecuteActionInput): Promise<ExecuteActionOutput> {
    // Lazy-boot: ensure the bundle sync has run at least once.
    this.get(BundleSyncService);
    const config = this.get(SkilledOpenApiConfig);
    const hiddenOps = this.get(HiddenOpRegistry);
    const bundleStore = this.get(BundleStore);
    const guard = this.get(AuthorityGuard);
    const resolver = this.get(SkilledOpenApiCredentialResolver);
    // Audit writer is opt-in: hosts that want a tamper-evident, signed,
    // hash-chained log of every skill action invocation register the
    // SkillAuditWriter token in DI (driven by `skillsConfig.audit.enabled`).
    // When absent, the tool runs as before with zero overhead.
    const auditWriter = this.tryGet<SkillAuditWriter>(SkillAuditWriterToken);
    const auditSubject = this.authInfo?.user?.sub ?? 'anonymous';

    // Detached audit writes — captured via this helper so a rejected promise
    // (signer/store/backend failure) is logged instead of becoming an
    // unhandled rejection. Audit failures must never propagate to the caller,
    // and the writer's hot path mustn't block on a slow backend.
    const detachAudit = (op: Promise<void>, phase: string): void => {
      op.catch((error) => {
        this.logger.warn(
          `[skill-audit] detached ${phase} write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    };

    // Skill action progress: 5 milestones aligned with the phases of this tool.
    // Each `progress()` call is a no-op when the caller didn't include a
    // progressToken, so the overhead is a couple of `if (!token) return false`
    // checks. Phases match the numbered comment blocks below.
    const TOTAL_STEPS = 5;
    const tick = (step: number, message: string): Promise<boolean> => this.progress(step, TOTAL_STEPS, message);

    // Telemetry: each phase emits a `skill_action.phase` event on the active
    // tool span. The accessor is resolved via `tryGet` so the tool runs
    // cleanly when ObservabilityPlugin isn't installed (no errors, no events).
    // Reading `this.telemetry` directly would trigger the context-extension
    // getter, which throws ContextExtensionNotAvailableError when the plugin
    // is absent — that crash is what this lookup avoids.
    interface PhaseTelemetry {
      addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
      setAttributes(attrs: Record<string, string | number | boolean>): void;
    }
    const TELEMETRY_ACCESSOR_TOKEN = Symbol.for('frontmcp:observability:telemetry-accessor');
    const tel = this.tryGet<PhaseTelemetry>(TELEMETRY_ACCESSOR_TOKEN);
    const phaseEvent = (phase: string, attrs?: Record<string, string | number | boolean>): void => {
      tel?.addEvent('skill_action.phase', {
        phase,
        skillId: input.skillId,
        actionId: input.actionId,
        ...(attrs ?? {}),
      });
    };

    await tick(1, 'resolve-action');
    phaseEvent('resolve-action');
    // 1) Resolve hidden op for (skillId, actionId).
    const entry = hiddenOps.get(input.skillId, input.actionId);
    if (!entry) {
      return {
        ok: false,
        status: 0,
        error: `unknown action "${input.skillId}/${input.actionId}" — search_skill / load_skill first`,
      };
    }

    // Pin a snapshot of the entry so a hot bundle-swap mid-call doesn't change
    // the descriptor we execute against (E1 from the plan). `bundleId` comes
    // from the pinned entry rather than from a fresh `bundleStore.current()`
    // read so the credential-scope resolution cannot drift to a newly swapped
    // bundle while the op continues to use the prior descriptor.
    const pinned = entry;
    const bundleId = pinned.bundleId;
    const bundle = bundleStore.current();

    await tick(2, 'authority-check');
    phaseEvent('authority-check', { bundleVersion: pinned.bundleVersion });
    // 2) Authority check (skill-level + op-level merged at call site).
    const policy = pinned.op.requiredAuthorities;
    const authResult = await guard.check({
      policy,
      authInfo: (this.authInfo ?? {}) as never as Parameters<AuthorityGuard['check']>[0]['authInfo'],
      input: input.input ?? {},
    });
    if (!authResult.granted) {
      // Audit: authority denial. Without this record the most security-
      // relevant events (someone trying to invoke an action they aren't
      // authorized for) would silently disappear from the audit log. We
      // detach the write (`void`) so a slow audit backend never blocks
      // the denial response — audit failures never propagate.
      if (auditWriter) {
        detachAudit(
          auditWriter.writeAuthorityFail(
            {
              subject: auditSubject,
              skillId: input.skillId,
              actionId: input.actionId,
              bundleId,
              bundleVersion: pinned.bundleVersion,
              input: input.input ?? {},
            },
            { reason: authResult.deniedBy ?? 'policy not satisfied' },
          ),
          'authority-check-fail',
        );
      }
      return {
        ok: false,
        status: 0,
        error: `authority denied: ${authResult.deniedBy ?? 'policy not satisfied'}`,
      };
    }

    // Audit: authority pass. Captured BEFORE the http call so even invocations
    // that fail at the network layer still leave a forensic record tying the
    // input to the policy decision. We detach the write (`void`) so a slow
    // audit backend never blocks the user's request — audit failures never
    // propagate.
    if (auditWriter) {
      detachAudit(
        auditWriter.writeAuthorityPass({
          subject: auditSubject,
          skillId: input.skillId,
          actionId: input.actionId,
          bundleId,
          bundleVersion: pinned.bundleVersion,
          input: input.input ?? {},
        }),
        'authority-check-pass',
      );
    }

    // 3) Compile (or fetch from cache) the input/output Zod schemas for this op.
    //    Uses Zod 4's native `z.fromJSONSchema`. Cached per (bundleVersion, operationId).
    const schemas = getCompiledOpSchemas({
      bundleVersion: pinned.bundleVersion,
      operationId: pinned.op.operationId,
      inputSchema: pinned.op.inputSchema,
      outputSchema: pinned.op.outputSchema,
    });

    await tick(3, 'input-validate');
    phaseEvent('input-validate', { bundleVersion: pinned.bundleVersion });
    // 4) Validate input strictly. Mirrors the SDK call-tool flow's parseInput
    //    stage — invalid input never reaches the upstream HTTP call.
    const inputParse = schemas.input.safeParse(input.input ?? {});
    if (!inputParse.success) {
      return {
        ok: false,
        status: 0,
        error: `input validation failed: ${formatZodIssues(inputParse.error.issues)}`,
      };
    }

    // 5) Build runtime deps + execute. Allowed hosts are derived from the
    //    PINNED descriptor's service first (so a hot bundle swap that drops
    //    the service mid-call doesn't strand the in-flight request), then
    //    union'd with the active bundle's services for defense-in-depth.
    const allowedHosts = new Set<string>();
    try {
      allowedHosts.add(new URL(pinned.service.baseUrl).hostname.toLowerCase());
    } catch {
      // pinned service URL malformed — execute path will fail SSRF anyway
    }
    if (bundle) {
      for (const svc of bundle.services) {
        try {
          allowedHosts.add(new URL(svc.baseUrl).hostname.toLowerCase());
        } catch {
          // skip malformed
        }
      }
    }

    const deps: OpenApiRuntimeDeps = {
      outbound: config.outbound,
      resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
      allowedHosts,
      logger: this.logger,
    };

    await tick(4, 'http-call');
    phaseEvent('http-call', { bundleVersion: pinned.bundleVersion });
    let result: Awaited<ReturnType<typeof executeOperation>>;
    try {
      result = await executeOperation({
        entry: pinned,
        bundleId,
        input: inputParse.data as Record<string, unknown>,
        deps,
      });
    } catch (e) {
      // Audit thrown errors before re-throwing so the chain captures every
      // post-authority invocation outcome, even ones that never produced an
      // ok=false envelope. Detached (`void`) — a slow audit backend MUST
      // NOT delay propagating the failure to the caller.
      if (auditWriter) {
        detachAudit(
          auditWriter.writeHttpCallFailure(
            {
              subject: auditSubject,
              skillId: input.skillId,
              actionId: input.actionId,
              bundleId,
              bundleVersion: pinned.bundleVersion,
              input: input.input ?? {},
            },
            { status: 0, error: e },
          ),
          'http-call-failure',
        );
      }
      throw e;
    }

    // Audit: record the http-call outcome. Both ok=true and ok=false flow
    // through here so the chain includes the caller-visible status code.
    // Detached (`void`) — see writeAuthorityPass above.
    if (auditWriter) {
      const auditCtx = {
        subject: auditSubject,
        skillId: input.skillId,
        actionId: input.actionId,
        bundleId,
        bundleVersion: pinned.bundleVersion,
        input: input.input ?? {},
      };
      if (result.ok) {
        detachAudit(
          auditWriter.writeHttpCallSuccess(auditCtx, {
            status: result.status,
            output: result.data ?? null,
          }),
          'http-call-success',
        );
      } else {
        detachAudit(
          auditWriter.writeHttpCallFailure(auditCtx, {
            status: result.status,
            error: result.error ?? `http call failed with status ${result.status}`,
          }),
          'http-call-failure',
        );
      }
    }

    // 6) Validate the response body shape against the op's outputSchema.
    //    Only runs on a successful upstream call AND when the response is
    //    application/json (text/binary bodies are returned as-is — the
    //    caller is presumed to have configured an appropriate schema or
    //    left it permissive). Error envelopes from the upstream (ok=false)
    //    pass through unchanged so the LLM can see the actual error string
    //    rather than a "schema validation failed" wrapper masking it.
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

    await tick(5, 'done');
    phaseEvent('done', { bundleVersion: pinned.bundleVersion });
    tel?.setAttributes({
      'skill_action.status': result.status,
      'skill_action.ok': result.ok,
      'skill_action.skill_id': input.skillId,
      'skill_action.action_id': input.actionId,
      'skill_action.bundle_version': pinned.bundleVersion,
    });
    return {
      ok: result.ok,
      status: result.status,
      ...(result.data !== undefined && result.data !== null ? { data: result.data } : {}),
      ...(result.contentType ? { contentType: result.contentType } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }
}

/**
 * Compact one-line render of zod issues for the meta-tool error envelope.
 * Avoids serializing the full ZodError (which includes call stacks the LLM
 * doesn't need and tokens we don't want to spend).
 */
function formatZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  if (!issues.length) return 'unspecified validation error';
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}
