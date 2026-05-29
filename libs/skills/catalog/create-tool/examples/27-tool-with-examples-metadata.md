---
name: 27-tool-with-examples-metadata
level: basic
description: 'Tool with the `examples: [...]` field on `@Tool({...})` — concrete input (and optional expected output) examples surfaced in `tools/list` so AI clients can render them as quick-action suggestions.'
tags: [examples-metadata, discovery, tools-list]
features:
  - 'Adding `examples: [{ description, input, output? }]` to `@Tool({...})` so AI clients see canned invocations'
  - 'Writing realistic example inputs so the description in `tools/list` is concrete, not abstract'
  - 'Including `output?` for examples where showing the expected result helps client UX (preview tiles, etc.)'
  - 'Why `examples` are advisory metadata — never relied on by the framework, only surfaced to discovery'
---

# Tool With Examples Metadata

Tool with the `examples: [...]` field on `@Tool({...})` — concrete input (and optional expected output) examples surfaced in `tools/list` so AI clients can render them as quick-action suggestions.

The `examples` field is purely advisory — AI clients use it to surface canned invocations in their UI (quick-action buttons, prompt suggestions, tool-picker previews). Use it for any tool that benefits from concrete usage hints.

## Code

```typescript
// src/apps/main/tools/convert-currency.tool.ts
import { Tool, ToolContext, ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

const inputSchema = {
  amount: z.number().positive(),
  from: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD'),
  to: z.string().regex(/^[A-Z]{3}$/),
};
const outputSchema = { converted: z.number(), rate: z.number(), asOf: z.string() };

@Tool({
  name: 'convert_currency',
  description: 'Convert an amount from one currency to another',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  examples: [
    {
      description: 'Convert 100 USD to EUR',
      input: { amount: 100, from: 'USD', to: 'EUR' },
      output: { converted: 91.4, rate: 0.914, asOf: '2026-05-29T12:00:00Z' },
    },
    {
      description: 'Convert 1,000,000 GBP to JPY',
      input: { amount: 1_000_000, from: 'GBP', to: 'JPY' },
    },
    {
      description: 'Convert 50 EUR to USD',
      input: { amount: 50, from: 'EUR', to: 'USD' },
    },
  ],
})
export class ConvertCurrencyTool extends ToolContext {
  async execute(
    input: ToolInputOf<{ inputSchema: typeof inputSchema }>,
  ): Promise<ToolOutputOf<{ outputSchema: typeof outputSchema }>> {
    const rate = await this.fetchRate(input.from, input.to);
    return { converted: +(input.amount * rate).toFixed(2), rate, asOf: new Date().toISOString() };
  }

  private async fetchRate(_from: string, _to: string): Promise<number> {
    return 0.914;
  }
}
```

## What This Demonstrates

- Adding `examples: [{ description, input, output? }]` to `@Tool({...})` so AI clients see canned invocations
- Writing realistic example inputs so the description in `tools/list` is concrete, not abstract
- Including `output?` for examples where showing the expected result helps client UX (preview tiles, etc.)
- Why `examples` are advisory metadata — never relied on by the framework, only surfaced to discovery

## Where examples show up

- **`tools/list` MCP response** — clients can render them as quick-action chips, suggestion lists, tool-picker previews.
- **`frontmcp skills list` CLI** — when the tool is documented in a skill catalog.
- **Generated docs** — `frontmcp build --target sdk` includes them in the published API.

## When to include `output?`

- ✅ When showing the expected output makes the tool's purpose clearer at a glance.
- ✅ For UI clients that render result previews — knowing the shape lets them lay out the chip / card before the user clicks.
- ❌ For tools where the output is highly variable / live data (e.g. `web_search` results). Just show the input.

## Don't

- Don't put sensitive example data — `examples` are public. Use synthetic IDs (`u_1`), test addresses (`@example.com`), demo amounts.
- Don't pad with low-value examples just to hit a count. 2–4 well-chosen examples beats 20 trivial ones.
- Don't rely on `examples` for documentation — they're advisory hints, not formal docs. Put substantive guidance in `description`.
