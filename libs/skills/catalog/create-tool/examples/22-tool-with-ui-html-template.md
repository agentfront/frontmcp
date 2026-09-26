---
name: 22-tool-with-ui-html-template
level: intermediate
description: "Tool with an inline HTML function template — `ui: { template: (ctx) => '<div>…</div>' }` — for a quick widget that doesn't need a separate `.tsx` file."
tags: [ui, ui-widgets, html-template, html-tag, escapeStringResults, TemplateContext]
features:
  - 'Adding a `ui:` block with a function template that returns markup built with the `ctx.helpers.html` tagged template'
  - 'Annotating `ctx` explicitly to dodge the TS7006 inference gap on the union `ui.template` type'
  - "Letting `ctx.helpers.html` escape every interpolated value so tool output can't inject markup into the widget"
  - 'Opting in to `escapeStringResults: true` so a plain string result is escaped — the default from FrontMCP 1.9'
  - 'Reading from `ctx.output` and `ctx.helpers` — the typed runtime context the template renderer hands you'
---

# Tool With Ui Html Template

Tool with an inline HTML function template — `ui: { template: (ctx) => '<div>…</div>' }` — for a quick widget that doesn't need a separate `.tsx` file.

For widgets that don't need React / state / interactivity, an inline function template is the simplest form. Read `ctx.output` and return markup built with the `ctx.helpers.html` tagged template — it escapes every value you interpolate.

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
    // `html` escapes interpolated values — no manual escapeHtml needed
    template: (ctx: TemplateContext<In, Out>) => ctx.helpers.html`
      <div style="padding:16px;font-family:system-ui;border-radius:12px;background:#f5f7fa">
        <h2 style="margin:0 0 8px">${ctx.output.city}</h2>
        <p style="font-size:48px;margin:0">${ctx.output.temperatureF}°F</p>
        <p style="margin:8px 0 0">${ctx.output.conditions}</p>
      </div>
    `,
    // Escape any plain string result; `html` results stay markup (the default from FrontMCP 1.9)
    escapeStringResults: true,
  },
})
export class ShowWeatherCardTool extends ToolContext {
  async execute(input: In): Promise<Out> {
    return { city: input.city, temperatureF: 72, conditions: 'Sunny' };
  }
}
```

## What This Demonstrates

- Adding a `ui:` block with a function template that returns markup built with the `ctx.helpers.html` tagged template
- Annotating `ctx` explicitly to dodge the TS7006 inference gap on the union `ui.template` type
- Letting `ctx.helpers.html` escape every interpolated value so tool output can't inject markup into the widget
- Opting in to `escapeStringResults: true` so a plain string result is escaped — the default from FrontMCP 1.9
- Reading from `ctx.output` and `ctx.helpers` — the typed runtime context the template renderer hands you

## Why `html` instead of a plain template literal

A plain string a template returns is rendered as markup when it looks like HTML, so `` `<p>${ctx.output.note}</p>` `` lets tool output inject tags unless you remember `escapeHtml` on every field. `ctx.helpers.html` escapes each interpolated value for you (nested `html` values and `ctx.helpers.trustedHtml(markup)` pass through as markup), and its result renders as markup whether or not `escapeStringResults` is on. Don't also call `escapeHtml` inside `html` — the value would be escaped twice. See [`ui-widgets.md`](../references/ui-widgets.md#trusted-markup-and-escaping-template-results).

## Why annotate `ctx` explicitly

`ui.template` is a union of multiple callable shapes (`TemplateBuilderFn | string | ((props: any) => any) | FileSource`). TypeScript can't pick a single contextual type for the arrow's parameter, so `template: (ctx) => …` fails under `strict` / `noImplicitAny` with TS7006:

```text
Parameter 'ctx' implicitly has an 'any' type.
```

Two ways out:

- Annotate `ctx: TemplateContext<In, Out>` (this example) — fastest fix for a small inline widget.
- Move the widget to a `.tsx` file and use the FileSource form (`{ file: widgetPath }`) — recommended for anything non-trivial. See [`23-tool-with-ui-filesource-tsx`](./23-tool-with-ui-filesource-tsx.md).

## When function templates are the right choice

- Tiny widget — a card, a table row, a status badge
- No state / interactivity
- No external CSS / fonts / scripts beyond static markup

Move to a `.tsx` FileSource widget the moment you reach for React, useState, event handlers, or anything beyond static markup.

## What `ctx.helpers` includes

| Helper                         | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `` html`…` ``                  | Build trusted markup; interpolated values are escaped         |
| `trustedHtml(markup)`          | Mark markup you produced or sanitized yourself as trusted     |
| `escapeHtml(str)`              | Escape HTML entities; returns `''` for null/undefined         |
| `formatDate(date, format?)`    | Locale-formatted date                                         |
| `formatCurrency(amount, ccy?)` | ISO-4217 currency formatting                                  |
| `uniqueId(prefix?)`            | Deterministic unique ID for DOM elements                      |
| `jsonEmbed(data)`              | Safely embed JSON in a `<script>` tag (escapes `<`, `>`, `&`) |
