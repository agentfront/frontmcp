import type { ListChangedKind } from '../common/interfaces/flow.interface';
import type { FrontMcpLogger } from '../common/interfaces/logger.interface';
import type { EnabledOption } from '../common/metadata/enabled.metadata';
import type { FrontMcpContext } from '../context/frontmcp-context';
import { FeatureOffError } from '../errors/mcp.error';

/** The switches of an entry: its own `enabled`, and the one the server's `enabled` maps it to. All must be on. */
export type EntrySwitches = EnabledOption | readonly (EnabledOption | undefined)[] | undefined;

/** An entry whose switches a scope can tell. */
export interface SwitchedEntry {
  readonly metadata: { readonly enabled?: EnabledOption };
}

/** What a scope offers to tell an entry's switches: its live surface, when it has one. */
export interface SwitchesScope {
  readonly surface?: { enabledOf(kind: ListChangedKind, entry: SwitchedEntry): EntrySwitches };
}

function switchList(enabled: EntrySwitches): readonly (EnabledOption | undefined)[] {
  return Array.isArray(enabled) ? enabled : [enabled as EnabledOption | undefined];
}

/** The switches of `entry` of the `kind` list in `scope`; its own `enabled` alone where the scope has no surface. */
export function switchesOf(scope: SwitchesScope, kind: ListChangedKind, entry: SwitchedEntry): EntrySwitches {
  return scope.surface?.enabledOf(kind, entry) ?? entry.metadata.enabled;
}

/** Whether one switch is on for this request. A source that throws counts as its `onError` says, else off. */
async function isSwitchOn(
  enabled: EnabledOption | undefined,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<boolean> {
  if (enabled === undefined || typeof enabled === 'boolean') return enabled !== false;
  try {
    return (await enabled.get(context)) === true;
  } catch (error) {
    const on = enabled.onError === 'on';
    logger?.warn(
      `An enabled source failed to answer, so its entry is ${on ? 'on' : 'off'}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return on;
  }
}

/** Whether an entry's switches are all on for this request. */
export async function isEntryEnabled(
  enabled: EntrySwitches,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<boolean> {
  for (const one of switchList(enabled)) {
    if (!(await isSwitchOn(one, context, logger))) return false;
  }
  return true;
}

/** Keep the items whose entry's switches are all on for this request. */
export async function enabledItems<T>(
  items: readonly T[],
  enabledOf: (item: T) => EntrySwitches,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<T[]> {
  const answers = await Promise.all(items.map((item) => isEntryEnabled(enabledOf(item), context, logger)));
  return items.filter((_item, index) => answers[index]);
}

/** Refuse an entry with a switch that is off, with the remedy of the first source that is off. */
export async function assertEntryEnabled(
  entryType: string,
  entryName: string,
  enabled: EntrySwitches,
  context: FrontMcpContext | undefined,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<void> {
  for (const one of switchList(enabled)) {
    if (await isSwitchOn(one, context, logger)) continue;
    throw new FeatureOffError(entryType, entryName, typeof one === 'object' ? one.remedy : undefined);
  }
}
