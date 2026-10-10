import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({ ran: z.string() });

/** A string ref to a flag the adapter does not know: the plugin's `gateDefaultValue: true` opens it. */
@Tool({
  name: 'gate-default-open',
  description: 'Gated by a flag the adapter does not know; opened by gateDefaultValue',
  inputSchema: {},
  outputSchema,
  featureFlag: 'unconfigured-gate-flag',
})
export class GateDefaultOpenTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return { ran: 'gate-default-open' };
  }
}

/** The same unknown flag with a ref default of `false`, which wins over `gateDefaultValue`. */
@Tool({
  name: 'gate-default-ref-closed',
  description: 'Gated by an unknown flag whose ref defaultValue (false) wins over gateDefaultValue',
  inputSchema: {},
  outputSchema,
  featureFlag: { key: 'unconfigured-gate-flag', defaultValue: false },
})
export class GateDefaultRefClosedTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return { ran: 'gate-default-ref-closed' };
  }
}

/** A flag the adapter answers `false` for stays off whatever `gateDefaultValue` says. */
@Tool({
  name: 'gate-default-known-off',
  description: 'Gated by a flag the adapter answers false for',
  inputSchema: {},
  outputSchema,
  featureFlag: 'gate-known-off',
})
export class GateDefaultKnownOffTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return { ran: 'gate-default-known-off' };
  }
}

/** `this.featureFlags.isEnabled()` keeps its own fallback (call, plugin `defaultValue`, `false`). */
@Tool({
  name: 'gate-default-accessor',
  description: 'Reads an unknown flag through this.featureFlags',
  inputSchema: {},
  outputSchema: z.object({ enabled: z.boolean() }),
})
export class GateDefaultAccessorTool extends ToolContext {
  async execute(): Promise<{ enabled: boolean }> {
    return { enabled: await this.featureFlags.isEnabled('unconfigured-gate-flag') };
  }
}
