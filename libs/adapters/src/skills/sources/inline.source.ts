// file: libs/adapters/src/skills/sources/inline.source.ts
//
// In-memory bundle source: the skilled-OpenAPI bundle object is embedded
// directly in the host code (no filesystem, no network). This is the source for
// V8-isolate runtimes (Cloudflare Workers) — `static` needs fs, `npm` needs a
// package install, and `saas` needs an endpoint, but a Worker can simply carry
// the bundle inline. The object is validated by the overlay parser, exactly like
// a file- or remote-loaded bundle.

import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { parseOverlay } from '../bundle/overlay-parser';
import type { InlineSourceOptions } from '../source-options';
import type { BundleSourceListener, SkillBundleSource } from './skill-bundle-source.interface';

/** Loads a bundle from an embedded object. Static (never refreshes). */
export class InlineSource implements SkillBundleSource {
  readonly id = 'inline:bundle';

  private readonly listeners = new Set<BundleSourceListener>();

  constructor(
    private readonly options: InlineSourceOptions,
    private readonly logger: FrontMcpLogger,
  ) {}

  async start(): Promise<void> {
    const bundle = this.parse();
    for (const fn of this.listeners) {
      try {
        fn(bundle);
      } catch (e) {
        this.logger.warn(`[inline-source] listener threw: ${(e as Error).message}`);
      }
    }
  }

  onChange(listener: BundleSourceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    this.listeners.clear();
  }

  private parse(): ResolvedBundle {
    return parseOverlay({ kind: 'object', content: this.options.content });
  }
}
