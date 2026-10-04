// file: libs/sdk/src/scope/server-entries.helper.ts

import type { ResourceType, ToolType } from '../common';
import type ProviderRegistry from '../provider/provider.registry';
import ResourceRegistry from '../resource/resource.registry';
import ToolRegistry from '../tool/tool.registry';
import { serverEntryOwner } from '../utils/lineage.utils';

/** Registers the server-level entries for the scope's tool and resource registries to adopt next to the apps'. */
export async function registerServerEntries(
  providers: ProviderRegistry,
  entries: { tools?: ToolType[]; resources?: ResourceType[] },
): Promise<void> {
  const registries: Promise<void>[] = [];
  if (entries.tools?.length) {
    registries.push(new ToolRegistry(providers, entries.tools, serverEntryOwner, { adopt: false }).ready);
  }
  if (entries.resources?.length) {
    registries.push(new ResourceRegistry(providers, entries.resources, serverEntryOwner, { adopt: false }).ready);
  }
  await Promise.all(registries);
}
