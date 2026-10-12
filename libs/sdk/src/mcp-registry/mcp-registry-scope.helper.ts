import type { FlowType } from '../common';
import type { McpRegistryOptionsInput } from '../common/types/options/registry';
import type FlowRegistry from '../flows/flow.registry';
import { ServerCardFlow, WellKnownAiCatalogFlow, WellKnownMcpRegistryAuthFlow } from './flows';

export interface McpRegistryScopeRegistrationOptions {
  flowRegistry: FlowRegistry;
  registryOptions?: McpRegistryOptionsInput;
  /** The scope at the entry path itself, not a `splitByApp` or `standalone` app's. */
  servesServerEndpoint: boolean;
}

/** The domain proof describes the host, so every scope serves it; the card and catalog describe the server's own endpoint. */
export async function registerMcpRegistryFlows(options: McpRegistryScopeRegistrationOptions): Promise<void> {
  const { flowRegistry, registryOptions, servesServerEndpoint } = options;
  if (!registryOptions) return;

  const flows: FlowType[] = [WellKnownMcpRegistryAuthFlow];
  if (servesServerEndpoint && registryOptions.name && registryOptions.serverCard !== false) {
    flows.push(ServerCardFlow);
    if (registryOptions.aiCatalog !== false) flows.push(WellKnownAiCatalogFlow);
  }
  await flowRegistry.registryFlows(flows);
}
