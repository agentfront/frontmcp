---
name: 22-tool-with-ui-html-template
level: intermediate
description: "Tool with an inline HTML function template — `ui: { template: (ctx) => '<div>…</div>' }` — for a quick widget that doesn't need a separate `.tsx` file."
tags: [ui, ui-widgets, html-template, escapeHtml, TemplateContext]
features:
  - 'Adding a `ui:` block with a function template `(ctx: TemplateContext<In, Out>) => string`'
  - 'Annotating `ctx` explicitly to dodge the TS7006 inference gap on the union `ui.template` type'
  - "Always escaping user-controlled output with `ctx.helpers.escapeHtml(...)` so the widget can't XSS itself"
  - 'Reading from `ctx.output` and `ctx.helpers` — the typed runtime context the template renderer hands you'
---

# Tool With Ui Html Template

Tool with an inline HTML function template — `ui: { template: (ctx) => '<div>…</div>' }` — for a quick widget that doesn't need a separate `.tsx` file.

For widgets that don't need React / state / interactivity, an inline function template is the simplest form. Read `ctx.output`, escape user-controlled fields, return an HTML string.

## Code

```typescript
// src/apps/main/tools/show-weather-card.tool.ts
import { Tool, ToolContext, z, type TemplateContext } from '@frontmcp/sdk';

const inputSchema = { city: z.string() };
const outputSchema = {
  city: z.string(),
  temperatureF: z.number(),
  conditions: z.string(),
};
type In = { city: string };
type Out = { city: string; temperatureF: number; conditions: string };

@Tool({
  name: 'show_weather_card',
  description: 'Show current weather as a card',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Current weather card',
    template: (ctx: TemplateContext<In, Out>) => `
      <div style="padding:16px;font-family:system-ui;border-radius:12px;background:#f5f7fa">
        <h2 style="margin:0 0 8px">${ctx.helpers.escapeHtml(ctx.output.city)}</h2>
        <p style="font-size:48px;margin:0">${ctx.output.temperatureF}°F</p>
        <p style="margin:8px 0 0">${ctx.helpers.escapeHtml(ctx.output.conditions)}</p>
      </div>
    `,
  },
})
export class ShowWeatherCardTool extends ToolContext {
  async execute(input: In): Promise<Out> {
    return { city: input.city, temperatureF: 72, conditions: 'Sunny' };
  }
}
```

## What This Demonstrates

- Adding a `ui:` block with a function template `(ctx: TemplateContext<In, Out>) => string`
- Annotating `ctx` explicitly to dodge the TS7006 inference gap on the union `ui.template` type
- Always escaping user-controlled output with `ctx.helpers.escapeHtml(...)` so the widget can't XSS itself
- Reading from `ctx.output` and `ctx.helpers` — the typed runtime context the template renderer hands you

## Why annotate `ctx` explicitly

`ui.template` is a union of multiple callable shapes (`TemplateBuilderFn | string | ((props: any) => any) | FileSource`). TypeScript can't pick a single contextual type for the arrow's parameter, so `template: (ctx) => …` fails under `strict` / `noImplicitAny` with TS7006:

```
Parameter 'ctx' implicitly has an 'any' type.
```

Two ways out:

- Annotate `ctx: TemplateContext<In, Out>` (this example) — fastest fix for a small inline widget.
- Move the widget to a `.tsx` file and use the FileSource form (`{ file: widgetPath }`) — recommended for anything non-trivial. See [`23-tool-with-ui-filesource-tsx`](./23-tool-with-ui-filesource-tsx.md).

## When function templates are the right choice

- Tiny widget — a card, a table row, a status badge
- No state / interactivity
- No external CSS / fonts / scripts beyond what `escapeHtml` can produce

Move to a `.tsx` FileSource widget the moment you reach for React, useState, event handlers, or anything beyond static markup.

## What `ctx.helpers` includes

| Helper                         | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `escapeHtml(str)`              | Escape HTML entities; returns `''` for null/undefined       |
| `formatDate(date, format?)`    | Locale-formatted date                                       |
| `formatCurrency(amount, ccy?)` | ISO-4217 currency formatting                                |
| `uniqueId(prefix?)`            | Deterministic unique ID for DOM elements                    |
| `jsonEmbed(data)`              | Safely embed JSON in a `<script>` tag (escapes `</script>`) |
