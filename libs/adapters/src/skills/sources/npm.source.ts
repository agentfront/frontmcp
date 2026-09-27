// file: plugins/plugin-skilled-openapi/src/sources/npm.source.ts

import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { parseOverlay } from '../bundle/overlay-parser';
import type { NpmSourceOptions } from '../source-options';
import type { BundleSourceListener, SkillBundleSource } from './skill-bundle-source.interface';

// Lazily-built dynamic importer — see NpmSource#dynamicImport. Hidden from
// static bundlers so a worker bundle that statically reaches NpmSource (via
// createBundleSource) stays analyzable; only constructed when actually used.
let npmDynamicImport: ((specifier: string) => Promise<unknown>) | undefined;

/**
 * Loads a bundle from an npm package's default (or named) export.
 *
 * Refresh model: npm sources do NOT auto-refresh — the package is pinned via
 * `package.json` and only updates after a server redeploy. This is the
 * intentional, lower-blast-radius distribution mode.
 *
 * Provenance verification (GitHub artifact attestations / Sigstore) is not
 * implemented. `verifyProvenance: true` (the default) therefore refuses the
 * package before it is imported: a setting that promises a supply-chain check
 * must not load code it could not check. Set `verifyProvenance: false` to load
 * the package without one, and rely on bundle signing (`requireSignature` +
 * `trustedKeys`) and a pinned package version instead.
 */
export class NpmSource implements SkillBundleSource {
  readonly id: string;

  private listeners = new Set<BundleSourceListener>();
  private cached?: ResolvedBundle;

  constructor(
    private readonly options: NpmSourceOptions,
    private readonly logger: FrontMcpLogger,
  ) {
    this.id = `npm:${this.options.packageName}${this.options.exportName ? `#${this.options.exportName}` : ''}`;
  }

  async start(): Promise<void> {
    const bundle = await this.loadBundleFromPackage();
    this.cached = bundle;
    this.notify(bundle);
  }

  onChange(listener: BundleSourceListener): () => void {
    this.listeners.add(listener);
    if (this.cached) {
      // Replay last bundle to late subscribers.
      try {
        listener(this.cached);
      } catch (e) {
        this.logger.warn(`[npm-source] listener threw on replay: ${(e as Error).message}`);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    this.listeners.clear();
  }

  private async loadBundleFromPackage(): Promise<ResolvedBundle> {
    if (this.options.verifyProvenance) {
      // Fail closed: provenance can't be verified yet, so don't import (and run) the package.
      throw new Error(
        `npm source "${this.options.packageName}": verifyProvenance is true, but npm provenance verification is not ` +
          `implemented, so the package was not loaded. Set verifyProvenance: false to load it without a provenance ` +
          `check, and sign the bundle (requireSignature + trustedKeys).`,
      );
    }

    const mod = await this.dynamicImport(this.options.packageName);
    const exportName = this.options.exportName ?? 'default';

    const modRecord = mod as Record<string, unknown>;
    const exported = modRecord[exportName] ?? (exportName === 'default' ? mod : undefined);
    if (exported === undefined || exported === null) {
      throw new Error(`npm source "${this.options.packageName}": export "${exportName}" not found on the package`);
    }
    return parseOverlay({ kind: 'object', content: exported });
  }

  // Indirected so tests can stub. The dynamic `import()` is wrapped in a
  // lazily-built `new Function` so static bundlers (esbuild / `wrangler dev` /
  // miniflare) don't try to resolve the runtime-computed package specifier at
  // build time — installing an npm bundle is a Node-only path that never runs
  // on a V8 isolate, but `createBundleSource` keeps NpmSource statically
  // reachable in the worker bundle. The Function is only built when this runs
  // (Node), so a Worker that merely bundles it never evaluates it.
  protected dynamicImport(specifier: string): Promise<unknown> {
    npmDynamicImport ??= new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    return npmDynamicImport(specifier);
  }

  private notify(bundle: ResolvedBundle): void {
    for (const fn of this.listeners) {
      try {
        fn(bundle);
      } catch (e) {
        this.logger.warn(`[npm-source] listener threw: ${(e as Error).message}`);
      }
    }
  }
}
