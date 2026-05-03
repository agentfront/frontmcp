// file: plugins/plugin-skilled-openapi/src/sync/bundle-sync.service.ts

import { type FrontMcpLogger, type SkillContent, type SkillRegistryInterface } from '@frontmcp/sdk';

import { diffBundles, formatDiffSummary, type BundleDiff } from '../bundle/bundle-diff';
import { type BundleStore } from '../bundle/bundle.store';
import {
  bundleSkillToActions,
  type AuthBinding,
  type OperationDescriptor,
  type ResolvedBundle,
  type ServiceDescriptor,
} from '../bundle/bundle.types';
import { type HiddenOpEntry, type HiddenOpRegistry } from '../registry/hidden-op.registry';
import { verifyBundleSignature } from '../security/bundle-signature';
import { type SignatureKey } from '../skilled-openapi.types';

export interface BundleSyncOptions {
  requireSignature: boolean;
  trustedKeys: SignatureKey[];
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
  ) {}

  /**
   * Validate signature and apply the bundle. Returns a structured result;
   * never throws on validation/registration failure (caller logs + ignores).
   * Throws ONLY on programmer error (e.g. invalid argument).
   */
  async apply(bundle: ResolvedBundle): Promise<BundleApplyResult> {
    if (!bundle) throw new Error('apply: bundle is required');

    // Gate 1: signature verification.
    if (this.options.requireSignature) {
      const verifyResult = verifyBundleSignature(bundle, this.options.trustedKeys);
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

    // Apply atomically: if any single skill registration fails, roll back the
    // hidden-op registry to the prior state.
    const snapshotEntries = [...this.hiddenOps.values()];
    const registeredHandles: { id: string; unregister: () => Promise<void> }[] = [];

    try {
      // 1) Sync hidden-op registry.
      this.rebuildHiddenOps(bundle);

      // 2) Sync skills in SkillRegistry.
      // Strategy: unregister anything previously registered by THIS service
      // that is no longer present, then (re)register everything in the new bundle.
      //
      // A) Unregister removed skills.
      for (const removedId of diff.removedSkillIds) {
        const handle = this.skillUnregisterByBundleId.get(removedId);
        if (handle) {
          await handle();
          this.skillUnregisterByBundleId.delete(removedId);
        }
      }
      // B) Register added + changed skills (changed re-registers replaces).
      for (const skill of bundle.skills) {
        const content = this.toSkillContent(skill, bundle);
        const handle = await this.skillRegistry.registerSkillContent(content, {
          source: `skilled-openapi:${bundle.bundleId}`,
        });
        registeredHandles.push(handle);
        // Replace any prior unregister fn for this id (replace, not orphan).
        const prior = this.skillUnregisterByBundleId.get(skill.id);
        if (prior) {
          // Old handle's unregister would now remove our newly-registered version
          // (since registry replaces by id) — discard it without invoking.
          this.skillUnregisterByBundleId.delete(skill.id);
        }
        this.skillUnregisterByBundleId.set(skill.id, handle.unregister);
      }

      // 3) Swap the active bundle pointer (this fires BundleStore listeners).
      this.bundleStore.swap(bundle);

      this.logger.info(`[bundle-sync] applied ${bundle.bundleId}@${bundle.version} (${formatDiffSummary(diff)})`);
      return { applied: true, bundleId: bundle.bundleId, bundleVersion: bundle.version, diff };
    } catch (e) {
      // Rollback: restore previous hidden-ops snapshot and unregister anything
      // newly registered.
      this.logger.error(
        `[bundle-sync] apply failed for ${bundle.bundleId}@${bundle.version}: ${(e as Error).message}; rolling back`,
      );
      this.hiddenOps.clear();
      for (const entry of snapshotEntries) {
        this.hiddenOps.set(entry);
      }
      for (const h of registeredHandles) {
        try {
          await h.unregister();
        } catch {
          // best effort
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
        if (!op) continue;
        const service = servicesById.get(op.serviceId);
        if (!service) continue;
        const authBinding: AuthBinding | undefined = bundle.authBindings[op.authBindingRef];
        if (!authBinding) continue;
        const entry: HiddenOpEntry = {
          skillId: skill.id,
          op,
          service,
          authBinding,
          bundleVersion: bundle.version,
        };
        this.hiddenOps.set(entry);
      }
    }
  }
}
