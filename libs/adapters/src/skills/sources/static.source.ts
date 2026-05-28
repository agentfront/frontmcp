// file: plugins/plugin-skilled-openapi/src/sources/static.source.ts
//
// All filesystem + path operations route through `@frontmcp/utils`, which
// resolves to env-aware implementations via the `#path` / `#fs` subpath
// imports and the `frontmcp build --target <env>` pipeline. Author code in
// this repo never imports `node:fs` / `node:path` directly per CLAUDE.md.

import type { FrontMcpLogger } from '@frontmcp/sdk';
import { extname, pathResolve, readFile, watchFile, type FileWatcherHandle } from '@frontmcp/utils';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { parseOverlay, type OverlayInput } from '../bundle/overlay-parser';
import type { StaticSourceOptions } from '../source-options';
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
  private watcher: FileWatcherHandle | undefined;
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
    const absPath = pathResolve(this.options.path);
    const raw = await readFile(absPath, 'utf8');
    const ext = extname(absPath).toLowerCase();

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
    const absPath = pathResolve(this.options.path);
    try {
      this.watcher = watchFile(absPath, () => this.scheduleRefresh());
    } catch (e) {
      // `watchFile` is Node-only (utils calls assertNode internally). On
      // platforms where fs.watch is rejected (containers without inotify),
      // or in a non-Node runtime that somehow reaches this path, fall back
      // to polling so the dev workflow still works wherever possible.
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
