---
name: 27-tool-with-examples-metadata
level: basic
description: 'Tool with the `examples: [...]` field on `@Tool({...})` — concrete input (and optional expected output) examples consumed by the CodeCall `codecall:describe` tool to give agents accurate usage examples.'
tags: [examples-metadata, codecall, describe]
features:
  - 'Adding `examples: [{ description, input, output? }]` to `@Tool({...})` so `codecall:describe` surfaces canned invocations'
  - 'Writing realistic example inputs so the generated describe output is concrete, not abstract'
  - 'Including `output?` for examples where showing the expected result helps an agent understand the tool'
  - 'Why `examples` are advisory metadata — not emitted in `tools/list`, only consumed by `codecall:describe`'
---

# Tool With Examples Metadata

Tool with the `examples: [...]` field on `@Tool({...})` — concrete input (and optional expected output) examples consumed by the CodeCall `codecall:describe` tool to give agents accurate usage examples.

The `examples` field is purely advisory — the CodeCall `describe` tool uses it as the highest-priority source of usage examples (user-provided examples take precedence over auto-generated ones, up to 5). It is **not** emitted in the `tools/list` MCP response. Use it for any tool that benefits from concrete usage hints when CodeCall is enabled.

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

- Adding `examples: [{ description, input, output? }]` to `@Tool({...})` so `codecall:describe` surfaces canned invocations
- Writing realistic example inputs so the generated describe output is concrete, not abstract
- Including `output?` for examples where showing the expected result helps an agent understand the tool
- Why `examples` are advisory metadata — not emitted in `tools/list`, only consumed by `codecall:describe`

## Where examples show up

- **`codecall:describe`** — the CodeCall plugin's `describe` tool uses these as its top-priority source of usage examples (user-provided examples win over auto-generated ones, capped at 5). This is the one place `examples` is actually read.
- **Not in `tools/list`** — the `tools/list` MCP response does not include `examples`; clients never see them there.

## When to include `output?`

- ✅ When showing the expected output makes the tool's purpose clearer at a glance.
- ✅ When an agent benefits from seeing a representative result shape in the `codecall:describe` output before composing a call.
- ❌ For tools where the output is highly variable / live data (e.g. `web_search` results). Just show the input.

## Don't

- Don't put sensitive example data — `examples` are surfaced verbatim to agents via `codecall:describe`. Use synthetic IDs (`u_1`), test addresses (`@example.com`), demo amounts.
- Don't pad with low-value examples just to hit a count. 2–4 well-chosen examples beats 20 trivial ones.
- Don't rely on `examples` for documentation — they're advisory hints, not formal docs. Put substantive guidance in `description`.
