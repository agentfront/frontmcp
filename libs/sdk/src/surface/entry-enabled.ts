import type { FrontMcpLogger } from '../common/interfaces/logger.interface';
import type { EnabledOption } from '../common/metadata/enabled.metadata';
import type { FrontMcpContext } from '../context/frontmcp-context';
import { FeatureOffError } from '../errors/mcp.error';

/** Whether an entry's `enabled` is on for this request. A source that throws counts as off. */
export async function isEntryEnabled(
  enabled: EnabledOption | undefined,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<boolean> {
  if (enabled === undefined || typeof enabled === 'boolean') return enabled !== false;
  try {
    return (await enabled.get(context)) === true;
  } catch (error) {
    logger?.warn(
      `An enabled source failed to answer, so its entry is off: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Keep the items whose entry's `enabled` is on for this request. */
export async function enabledItems<T>(
  items: readonly T[],
  enabledOf: (item: T) => EnabledOption | undefined,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<T[]> {
  const answers = await Promise.all(items.map((item) => isEntryEnabled(enabledOf(item), context, logger)));
  return items.filter((_item, index) => answers[index]);
}

/** Refuse an entry whose `enabled` is off, with the remedy of its source. */
export async function assertEntryEnabled(
  entryType: string,
  entryName: string,
  enabled: EnabledOption | undefined,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<void> {
  if (await isEntryEnabled(enabled, context, logger)) return;
  throw new FeatureOffError(entryType, entryName, typeof enabled === 'object' ? enabled.remedy : undefined);
}
