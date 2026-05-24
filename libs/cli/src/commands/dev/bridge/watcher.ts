/**
 * File watcher for the dev bridge (issue #399).
 *
 * In bridge mode, `tsx` is used as a loader (no `--watch`) — the bridge
 * owns the watcher so it can emit a `reload-start` signal to the state
 * machine. Today's `tsx --watch` owns the watcher internally, which is
 * why it can't coordinate with anyone else.
 *
 * Uses `fs.watch` (Node built-in, no dep) with a 150ms debounce. The
 * default ignore list filters `node_modules`, `.git`, `dist`, and the
 * non-TS extensions that don't trigger source-of-truth reloads.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BridgeLogger } from './log';

export interface DevWatcherOptions {
  /** Directory to watch (typically the entry's parent). */
  rootDir: string;
  /** Debounce window in ms — multiple events within this window collapse. */
  debounceMs?: number;
  /** Glob fragments to skip. Default: node_modules, .git, dist, .frontmcp. */
  ignore?: string[];
  /** Extensions that trigger reload. Default: .ts, .tsx, .js, .mjs, .cjs. */
  triggerExtensions?: string[];
  log: BridgeLogger;
  onChange: (relativePath: string) => void;
}

export interface DevWatcher {
  start(): void;
  stop(): void;
}

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', '.frontmcp'];
const DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];

export function createDevWatcher(options: DevWatcherOptions): DevWatcher {
  const debounce = options.debounceMs ?? 150;
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const exts = options.triggerExtensions ?? DEFAULT_EXTS;
  const log = options.log;
  let timer: NodeJS.Timeout | undefined;
  let lastTrigger: string | undefined;
  let watcher: fs.FSWatcher | undefined;

  function shouldIgnore(rel: string): boolean {
    if (ignore.some((seg) => rel.split(path.sep).includes(seg))) return true;
    const ext = path.extname(rel);
    return ext.length > 0 && !exts.includes(ext);
  }

  function fire(rel: string): void {
    lastTrigger = rel;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const triggerLabel = lastTrigger ?? '(unknown)';
      log.reloadEvent('watcher', { trigger: triggerLabel });
      options.onChange(triggerLabel);
    }, debounce);
  }

  return {
    start() {
      try {
        watcher = fs.watch(options.rootDir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          // Node's `fs.watch` types `filename` as `string | null` here
          // (no `encoding: 'buffer'` option set), so a `typeof filename ===
          // 'string'` narrow leaves the else-branch as `never` and trips
          // TS2339. `String(filename)` is defensive for any future widening
          // (e.g., a `Buffer` arriving via a polyfill) without confusing
          // the type checker.
          const rel = String(filename);
          if (shouldIgnore(rel)) return;
          fire(rel);
        });
        watcher.on('error', (err) => {
          log.warn('watcher-error', { error: err.message });
        });
        log.info('watcher-started', { rootDir: options.rootDir, debounceMs: debounce });
      } catch (err) {
        log.error('watcher-start-failed', { error: (err as Error).message });
      }
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      try {
        watcher?.close();
      } catch {
        // ignore
      }
      log.info('watcher-stopped');
    },
  };
}
