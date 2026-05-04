// file: plugins/plugin-skilled-openapi/src/sources/static.source.ts

// File reads route through `@frontmcp/utils` per project convention; the watch
// API stays on `node:fs` because utils does not currently expose a watcher.
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';

import type { FrontMcpLogger } from '@frontmcp/sdk';
import { readFile } from '@frontmcp/utils';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { parseOverlay, type OverlayInput } from '../bundle/overlay-parser';
import type { StaticSourceOptions } from '../skilled-openapi.types';
import type { BundleSourceListener, SkillBundleSource } from './skill-bundle-source.interface';

/**
 * Loads a bundle from a local file (YAML or JSON). Optionally watches the
 * file for changes via `fs.watch` and re-fetches on edit.
 *
 * Bundle file extensions:
 *   - `.yaml` / `.yml` — parsed as YAML
 *   - `.json`         — parsed as JSON
 *   - anything else   — content sniffed (starts with `{` or `[` => JSON; else YAML)
 */
export class StaticSource implements SkillBundleSource {
  readonly id: string;

  private listeners = new Set<BundleSourceListener>();
  private watcher: FSWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly options: StaticSourceOptions,
    private readonly logger: FrontMcpLogger,
  ) {
    this.id = `static:${this.options.path}`;
  }

  async start(): Promise<void> {
    const bundle = await this.fetchOnce();
    this.notify(bundle);
    if (this.options.watch) {
      this.beginWatch();
    }
  }

  onChange(listener: BundleSourceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.listeners.clear();
  }

  private async fetchOnce(): Promise<ResolvedBundle> {
    const absPath = path.resolve(this.options.path);
    const raw = await readFile(absPath, 'utf8');
    const ext = path.extname(absPath).toLowerCase();

    let input: OverlayInput;
    if (ext === '.json') {
      input = { kind: 'json', content: raw };
    } else if (ext === '.yaml' || ext === '.yml') {
      input = { kind: 'yaml', content: raw };
    } else {
      const trimmed = raw.trimStart();
      input =
        trimmed.startsWith('{') || trimmed.startsWith('[')
          ? { kind: 'json', content: raw }
          : { kind: 'yaml', content: raw };
    }
    return parseOverlay(input);
  }

  private notify(bundle: ResolvedBundle): void {
    for (const fn of this.listeners) {
      try {
        fn(bundle);
      } catch (e) {
        this.logger.warn(`[static-source] listener threw: ${(e as Error).message}`);
      }
    }
  }

  private beginWatch(): void {
    const absPath = path.resolve(this.options.path);
    try {
      this.watcher = fsWatch(absPath, { persistent: false }, () => this.scheduleRefresh());
    } catch (e) {
      // Some platforms / file types reject fs.watch. Fall back to polling
      // every 2s so dev workflow still works.
      this.logger.warn(`[static-source] fs.watch failed (${(e as Error).message}); polling at 2s instead`);
      const tick = (): void => {
        if (this.stopped) return;
        this.scheduleRefresh();
        setTimeout(tick, 2000).unref?.();
      };
      setTimeout(tick, 2000).unref?.();
    }
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        const bundle = await this.fetchOnce();
        this.notify(bundle);
      } catch (e) {
        this.logger.warn(`[static-source] refresh failed: ${(e as Error).message}`);
      }
    }, 250);
    this.debounceTimer.unref?.();
  }
}
