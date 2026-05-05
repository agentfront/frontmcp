// file: plugins/plugin-skilled-openapi/src/sync/bundle-sync.service.ts

import {
  bundleSkillToActions,
  diffBundles,
  formatDiffSummary,
  resolveSkillLoadOrder,
  SkillDependencyCycleError,
  SkillDependencyMissingError,
  verifyBundleSignature,
  type AuthBinding,
  type BundleDiff,
  type BundleStore,
  type OperationDescriptor,
  type ResolvedBundle,
  type ServiceDescriptor,
  type SignatureVerifyTelemetry,
} from '@frontmcp/adapters/skills';
import { type FrontMcpLogger, type SkillContent, type SkillRegistryInterface } from '@frontmcp/sdk';

import { type HiddenOpEntry, type HiddenOpRegistry } from '../registry/hidden-op.registry';
import { type SignatureKey } from '../skilled-openapi.types';
import { type OperationToolFactory } from '../tools/operation-tool.factory';

export interface BundleSyncOptions {
  requireSignature: boolean;
  trustedKeys: SignatureKey[];
  /**
   * Optional telemetry hook for the signature verification path. When
   * provided, every signature check increments
   * `frontmcp_skills_signature_verifications_total{status}` and failures
   * additionally increment `frontmcp_skills_signature_failures_total{reason}`.
   * Wired by the plugin's DI factory when ObservabilityPlugin is installed;
   * `undefined` in tests / hosts without observability.
   */
  telemetry?: SignatureVerifyTelemetry;
  /**
   * When true (default), each operation in the bundle is also registered as
   * an internal tool (visibility: 'internal') in the SDK's tool registry so
   * other tools / agents / CodeCall scripts / jobs can compose with it via
   * `this.callTool(name, args)` from `ExecutionContextBase`. Internal tools
   * are excluded from `tools/list` and rejected for external `tools/call`.
   * The existing meta-tools (`search_skill` / `load_skill` / `execute_action`)
   * are unaffected.
   */
  exposeOperationsAsInternalTools: boolean;
}

export interface BundleApplyResult {
  applied: boolean;
  reason?: string;
  bundleId: string;
  bundleVersion: string;
  diff?: BundleDiff;
}

/**
 * Glue between a `BundleSource` (or any caller producing a `ResolvedBundle`)
 * and the SkillRegistry / HiddenOpRegistry. Enforces the v1.2 security gates
 * (signature) and applies the diff atomically.
 *
 * Atomicity contract: a bundle either fully applies (every added/changed
 * skill registered, every removed skill unregistered, hidden-op registry
 * fully synced) OR the active bundle stays unchanged. Failures emit a
 * structured `BundleApplyResult` with `applied: false` and a `reason`.
 *
 * Listeners can subscribe via the underlying BundleStore for downstream
 * effects (audit log, OTel attributes, /healthz updates).
 */
export class BundleSyncService {
  private skillUnregisterByBundleId = new Map<string, () => Promise<void>>();

  constructor(
    private readonly skillRegistry: SkillRegistryInterface,
    private readonly hiddenOps: HiddenOpRegistry,
    private readonly bundleStore: BundleStore,
    private readonly options: BundleSyncOptions,
    private readonly logger: FrontMcpLogger,
    /**
     * Optional factory that registers each operation as an internal SDK tool.
     * Wired by the plugin's DI factory when `exposeOperationsAsInternalTools`
     * is true and the SDK ToolRegistry is reachable from scope. Absent when
     * the host opted out OR when the plugin runs in a context without a
     * tool registry (e.g. unit tests for the sync service in isolation).
     */
    private readonly operationToolFactory?: OperationToolFactory,
  ) {}

  /**
   * Validate signature and apply the bundle. Returns a structured result;
   * never throws on validation/registration failure (caller logs + ignores).
   * Throws ONLY on programmer error (e.g. invalid argument).
   */
  async apply(bundle: ResolvedBundle): Promise<BundleApplyResult> {
    if (!bundle) throw new Error('apply: bundle is required');

    // Gate 0: pin guard. When operators have pinned the active version,
    // source-driven swaps accumulate in history elsewhere but are never
    // committed. We surface this as a structured non-error result so the
    // host can log it without paging anyone. The same-version case must
    // also short-circuit here — `bundleStore.swap()` throws BundlePinnedError
    // unconditionally while the store is pinned, so falling through would
    // turn a no-op into a rollback failure.
    if (this.bundleStore.isPinned()) {
      const pinned = this.bundleStore.pinned();
      return {
        applied: false,
        reason:
          pinned === bundle.version
            ? `bundle store pinned to ${pinned}; ${bundle.version} already active`
            : `bundle store pinned to ${pinned}; ${bundle.version} not applied`,
        bundleId: bundle.bundleId,
        bundleVersion: bundle.version,
      };
    }

    // Gate 1: signature verification.
    if (this.options.requireSignature) {
      const verifyResult = verifyBundleSignature(bundle, this.options.trustedKeys, this.options.telemetry);
      if (!verifyResult.ok) {
        this.logger.warn(`[bundle-sync] rejected bundle ${bundle.bundleId}@${bundle.version}: ${verifyResult.reason}`);
        return {
          applied: false,
          reason: verifyResult.reason,
          bundleId: bundle.bundleId,
          bundleVersion: bundle.version,
        };
      }
    }

    const previous = this.bundleStore.current();
    const diff = diffBundles(previous, bundle);

    // Snapshot every piece of state we mutate so a failure mid-apply can be
    // fully reversed:
    //   - hiddenOps entries (the registry is rebuilt from scratch below).
    //   - skillUnregisterByBundleId (so we can restore the prior unregister
    //     handles if rollback re-registers replaced/removed skills).
    //   - priorContents: SkillContent that was registered for skills in the
    //     PREVIOUS bundle, keyed by id. When a skill is replaced or removed,
    //     we use these snapshots to re-register the prior version on rollback.
    const snapshotEntries = [...this.hiddenOps.values()];
    const priorHandles = new Map(this.skillUnregisterByBundleId);
    const priorContents: Map<string, SkillContent> = previous
      ? new Map(previous.skills.map((s) => [s.id, this.toSkillContent(s, previous)] as const))
      : new Map();

    // Track everything we mutate during the staged apply so the catch block
    // can unwind it. `newHandles` is populated as each register call succeeds;
    // `successfullyRemovedIds` is populated as each removed-skill unregister
    // succeeds. These let rollback know exactly what to undo.
    const newHandles: { id: string; unregister: () => Promise<void> }[] = [];
    const successfullyRemovedIds: string[] = [];

    try {
      // 1) Sync hidden-op registry. This throws if the bundle references an
      //    unknown service / authBinding / operation, which trips the rollback
      //    path below and keeps the previous bundle active.
      this.rebuildHiddenOps(bundle);

      // 2) Resolve dependency-respecting load order. Cycles + missing deps
      //    trip the rollback path so a malformed bundle doesn't half-apply.
      let orderedSkills: ResolvedBundle['skills'];
      try {
        orderedSkills = resolveSkillLoadOrder(bundle.skills);
      } catch (e) {
        if (e instanceof SkillDependencyCycleError) {
          throw new Error(
            `[bundle-sync] dependency cycle in ${bundle.bundleId}@${bundle.version}: ${e.cycle.join(' -> ')}`,
          );
        }
        if (e instanceof SkillDependencyMissingError) {
          throw new Error(
            `[bundle-sync] missing dependency in ${bundle.bundleId}@${bundle.version}: skill "${e.skillId}" requires "${e.missingId}"`,
          );
        }
        throw e;
      }

      // 3) Stage all skill registrations BEFORE removing anything, in dep order.
      //    registerSkillContent with an existing id replaces in-place inside
      //    the SkillRegistry, so prior versions are not visible to consumers
      //    once their replacement has been registered. If any registration
      //    throws, the rollback path re-registers prior versions from
      //    `priorContents`.
      for (const skill of orderedSkills) {
        const content = this.toSkillContent(skill, bundle);
        const handle = await this.skillRegistry.registerSkillContent(content, {
          source: `skilled-openapi:${bundle.bundleId}`,
        });
        newHandles.push(handle);
      }

      // 3) Now that every new/changed skill is in place, unregister anything
      //    the new bundle drops. If a removal fails, rollback re-registers
      //    those skills via `priorContents`.
      for (const removedId of diff.removedSkillIds) {
        const handle = priorHandles.get(removedId);
        if (handle) {
          await handle();
          successfullyRemovedIds.push(removedId);
        }
      }

      // 4) Commit the tracking map. The new bundle's skills are the only
      //    handles we care about going forward — anything not in `newHandles`
      //    was either removed in step 3 or never registered by us.
      this.skillUnregisterByBundleId.clear();
      for (const h of newHandles) {
        this.skillUnregisterByBundleId.set(h.id, h.unregister);
      }

      // 5) Sync per-operation internal tools (visibility: 'internal').
      //    This is best-effort: a registration error logs a warning and
      //    continues — meta-tools still work, internal-tool composition for
      //    that op is just unavailable until the next swap.
      if (this.options.exposeOperationsAsInternalTools && this.operationToolFactory) {
        try {
          this.operationToolFactory.unregisterAll();
          for (const entry of this.hiddenOps.values()) {
            try {
              this.operationToolFactory.register(entry);
            } catch (regErr) {
              this.logger.warn(
                `[bundle-sync] internal-tool register failed for ${entry.bundleId}.${entry.op.operationId}: ${(regErr as Error).message}`,
              );
            }
          }
        } catch (factoryErr) {
          this.logger.warn(
            `[bundle-sync] internal-tool factory error: ${(factoryErr as Error).message}; continuing without internal tools`,
          );
        }
      }

      // 6) Swap the active bundle pointer (this fires BundleStore listeners).
      this.bundleStore.swap(bundle);

      this.logger.info(`[bundle-sync] applied ${bundle.bundleId}@${bundle.version} (${formatDiffSummary(diff)})`);
      return { applied: true, bundleId: bundle.bundleId, bundleVersion: bundle.version, diff };
    } catch (e) {
      this.logger.error(
        `[bundle-sync] apply failed for ${bundle.bundleId}@${bundle.version}: ${(e as Error).message}; rolling back`,
      );

      // Rollback step A: restore the hidden-op registry to its pre-apply state.
      this.hiddenOps.clear();
      for (const entry of snapshotEntries) {
        this.hiddenOps.set(entry);
      }

      // Rollback step A.1: undo any internal tool registrations from this
      // failed apply, then re-register the prior bundle's operations so
      // composition callers continue to see the previous bundle's surface.
      if (this.options.exposeOperationsAsInternalTools && this.operationToolFactory) {
        try {
          this.operationToolFactory.unregisterAll();
          for (const entry of snapshotEntries) {
            try {
              this.operationToolFactory.register(entry);
            } catch {
              // best-effort restore
            }
          }
        } catch {
          // best-effort
        }
      }

      // Rollback step B: tear down anything the staged apply registered. Each
      // unregister is best-effort; one failure must not stop the rest of the
      // rollback from running.
      for (const h of newHandles) {
        try {
          await h.unregister();
        } catch {
          // best effort
        }
      }

      // Rollback step C: re-register prior content for every skill we either
      // replaced (id present in both prior and new bundle) or successfully
      // removed in step 3. This restores the previous bundle's contract from
      // the registry's perspective; the bundleStore pointer was never swapped,
      // so callers reading via bundleStore.current() also see the prior bundle.
      const toRestore = new Map<string, SkillContent>();
      for (const h of newHandles) {
        const prev = priorContents.get(h.id);
        if (prev) toRestore.set(h.id, prev);
      }
      for (const id of successfullyRemovedIds) {
        const prev = priorContents.get(id);
        if (prev) toRestore.set(id, prev);
      }

      // Start from the snapshot of prior unregister handles, then overwrite
      // any restored ids with the freshly-issued handle.
      this.skillUnregisterByBundleId = new Map(priorHandles);
      for (const [id, content] of toRestore) {
        try {
          const handle = await this.skillRegistry.registerSkillContent(content, {
            source: `skilled-openapi:${bundle.bundleId}:rollback`,
          });
          this.skillUnregisterByBundleId.set(id, handle.unregister);
        } catch (restoreErr) {
          this.logger.error(
            `[bundle-sync] failed to restore prior skill ${id} during rollback: ${(restoreErr as Error).message}`,
          );
          this.skillUnregisterByBundleId.delete(id);
        }
      }

      return {
        applied: false,
        reason: `rollback: ${(e as Error).message}`,
        bundleId: bundle.bundleId,
        bundleVersion: bundle.version,
      };
    }
  }

  /**
   * Project a single BundledSkill into a SkillContent the SDK SkillRegistry
   * understands. The `actions[]` extension carries the per-op schemas the LLM
   * needs to know about; `bundleVersion` lets polling clients detect changes.
   */
  private toSkillContent(skill: ResolvedBundle['skills'][number], bundle: ResolvedBundle): SkillContent {
    const actions = bundleSkillToActions(skill, bundle.operations);
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      tools: [],
      actions,
      bundleVersion: bundle.version,
    };
  }

  private rebuildHiddenOps(bundle: ResolvedBundle): void {
    this.hiddenOps.clear();
    const servicesById = new Map<string, ServiceDescriptor>(bundle.services.map((s) => [s.id, s] as const));
    for (const skill of bundle.skills) {
      for (const opId of skill.operationIds) {
        const op: OperationDescriptor | undefined = bundle.operations[opId];
        if (!op) {
          throw new Error(
            `[bundle-sync] malformed bundle ${bundle.bundleId}@${bundle.version}: skill "${skill.id}" references unknown operationId "${opId}"`,
          );
        }
        const service = servicesById.get(op.serviceId);
        if (!service) {
          throw new Error(
            `[bundle-sync] malformed bundle ${bundle.bundleId}@${bundle.version}: operation "${opId}" references unknown serviceId "${op.serviceId}"`,
          );
        }
        const authBinding: AuthBinding | undefined = bundle.authBindings[op.authBindingRef];
        if (!authBinding) {
          throw new Error(
            `[bundle-sync] malformed bundle ${bundle.bundleId}@${bundle.version}: operation "${opId}" references unknown authBindingRef "${op.authBindingRef}"`,
          );
        }
        const entry: HiddenOpEntry = {
          skillId: skill.id,
          op,
          service,
          authBinding,
          bundleId: bundle.bundleId,
          bundleVersion: bundle.version,
        };
        this.hiddenOps.set(entry);
      }
    }
  }
}
