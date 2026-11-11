// file: libs/sdk/src/channel/sources/file-watcher.source.ts

import { watchFiles, type FileWatchEventType } from '@frontmcp/utils';

import { ChannelContext, type FrontMcpLogger } from '../../common';
import type { ChannelFileEvent, ChannelFileWatcherSource } from '../../common/metadata/channel.metadata';
import { isLongLivedProcess } from '../../duty/lease-store';
import type { ChannelInstance } from '../channel.instance';

type DeclaredFileEvent = NonNullable<ChannelFileWatcherSource['events']>[number];

/** The `watchFiles` event types behind each declared event: a renamed file is gone from one path and appears at another. */
const WATCHED_TYPES: Record<DeclaredFileEvent, FileWatchEventType[]> = {
  create: ['add'],
  change: ['change'],
  delete: ['unlink'],
  rename: ['add', 'unlink'],
};

/** The name a channel reads for each `watchFiles` event type. */
const REPORTED_EVENTS: Record<FileWatchEventType, ChannelFileEvent['event']> = {
  add: 'create',
  change: 'change',
  unlink: 'delete',
};

/**
 * Whether a channel defines its own `onConnect()`, on its class or on a class it extends. Such a channel watches by
 * itself, as every file-watcher channel did before the framework watched, so its declared paths are left to it.
 */
export function connectsItself(context: ChannelContext): boolean {
  return context.onConnect !== ChannelContext.prototype.onConnect;
}

/** The `watchFiles` event types a source asks for: every type when it declares no events. */
function watchedTypesOf(sourceConfig: ChannelFileWatcherSource): FileWatchEventType[] | undefined {
  if (!sourceConfig.events) return undefined;
  const watchedTypes = sourceConfig.events.flatMap((declaredEvent) => WATCHED_TYPES[declaredEvent]);
  return [...new Set(watchedTypes)];
}

/** Warn about declared paths that look like globs: they are watched as written, never expanded. */
function warnAboutGlobs(channelName: string, paths: string[], logger: FrontMcpLogger): void {
  const globs = paths.filter((path) => path.includes('*'));
  if (globs.length === 0) return;
  logger.warn(
    `Channel "${channelName}" declares ${globs.map((glob) => `"${glob}"`).join(', ')}: a file-watcher path is not ` +
      'expanded as a glob. Declare the directory to watch its direct files.',
  );
}

/** Hand each file event of the declared paths to the channel, one at a time and in order, until `signal` aborts. */
async function forwardFileEvents(
  channel: ChannelInstance,
  sourceConfig: ChannelFileWatcherSource,
  signal: AbortSignal,
  logger: FrontMcpLogger,
): Promise<void> {
  const events = watchedTypesOf(sourceConfig);
  for await (const { type, path } of watchFiles(sourceConfig.paths, { events, signal })) {
    const fileEvent: ChannelFileEvent = { event: REPORTED_EVENTS[type], path };
    logger.verbose(`File ${fileEvent.event} for channel "${channel.name}": ${path}`);
    try {
      await channel.handleEvent(fileEvent);
    } catch (error) {
      logger.error(`Failed to handle a file event in channel "${channel.name}"`, { error });
    }
  }
}

/**
 * Wires a file-watcher channel source: watches the declared paths and hands each file event to the channel as a
 * `ChannelFileEvent`. A channel that defines its own `onConnect()` watches by itself, and nothing is watched in a
 * serverless, edge or browser runtime. A watch that fails is logged, and the channel stays connected.
 *
 * @param channel - The channel instance to push notifications to
 * @param context - The connected context of the channel
 * @param sourceConfig - The file-watcher source configuration
 * @param logger - Logger instance
 * @returns The function that ends the watch
 */
export function wireFileWatcherSource(
  channel: ChannelInstance,
  context: ChannelContext,
  sourceConfig: ChannelFileWatcherSource,
  logger: FrontMcpLogger,
): () => void {
  if (connectsItself(context)) {
    logger.info(
      `Channel "${channel.name}" defines onConnect(), so it watches by itself: the framework does not watch its ` +
        'declared paths. Remove onConnect() to have the framework watch them.',
    );
    return () => undefined;
  }
  if (!isLongLivedProcess()) {
    logger.warn(
      `Channel "${channel.name}" does not watch its paths in a serverless, edge or browser runtime: ` +
        'watching files needs a long-lived process',
    );
    return () => undefined;
  }
  warnAboutGlobs(channel.name, sourceConfig.paths, logger);

  const watch = new AbortController();
  forwardFileEvents(channel, sourceConfig, watch.signal, logger).catch((error) => {
    logger.error(`Channel "${channel.name}" stopped watching its paths`, { error });
  });
  return () => watch.abort();
}
