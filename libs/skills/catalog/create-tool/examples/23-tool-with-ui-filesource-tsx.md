---
name: 23-tool-with-ui-filesource-tsx
level: advanced
description: 'Tool with a `.tsx` widget in a separate file via the `FileSource` form — the recommended pattern for any React widget. Path anchored with `import.meta.url` so it survives any cwd.'
tags: [ui, ui-widgets, FileSource, tsx, import.meta.url, host-detect]
features:
  - 'Pointing `template` at a sibling `.tsx` file via the `FileSource` form `{ file: ... }`'
  - "Anchoring the path to the tool source with `fileURLToPath(new URL('./...widget.tsx', import.meta.url))` so `process.cwd()` doesn't matter"
  - "Leaving `resourceMode` unset — the framework host-detects (`'inline'` for Claude, `'cdn'` for others)"
  - "Naming the widget `*.widget.tsx` so the scaffolded `tsconfig.json`'s `exclude` keeps it out of the server typecheck"
---

# Tool With Ui Filesource Tsx

Tool with a `.tsx` widget in a separate file via the `FileSource` form — the recommended pattern for any React widget. Path anchored with `import.meta.url` so it survives any cwd.

For any React widget, FileSource is the right pattern. The widget lives in its own `.widget.tsx` file with its own React imports; the tool decorator just points at it.

> **Prerequisite:** `@frontmcp/ui` installed at the same version as `@frontmcp/sdk`. Without it, server-side bundling fails — the framework injects an auto-generated React mount that imports `McpBridgeProvider` from `@frontmcp/ui/react`.

## Code

```typescript
// src/apps/main/tools/sales-chart/sales-chart.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = { year: z.number().int().min(2000).max(2100) };
export const outputSchema = {
  year: z.number(),
  monthly: z.array(z.object({ month: z.string(), revenueUsd: z.number() })),
};
export type SalesChartInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type SalesChartOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/sales-chart/sales-chart.tool.ts
import { fileURLToPath } from 'node:url';

import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type SalesChartInput, type SalesChartOutput } from './sales-chart.schema';

// Anchor the widget path to THIS source file — bare relative paths resolve
// against process.cwd() (issue #444), which fails in any non-trivial layout.
const widgetPath = fileURLToPath(new URL('./sales-chart.widget.tsx', import.meta.url));

@Tool({
  name: 'sales_chart',
  description: 'Render a yearly sales bar chart',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Monthly revenue chart',
    template: { file: widgetPath },
    // resourceMode is intentionally UNSET — framework host-detects: 'inline' for Claude
    // (React bundled in, widget renders under Claude's CSP), 'cdn' for OpenAI / ChatGPT /
    // Cursor / MCP Inspector (smaller payload from esm.sh). Issue #456.
    hydrate: false, // SSR-only — dodges React error #418 in iframe sandboxes
  },
})
export class SalesChartTool extends ToolContext {
  async execute(input: SalesChartInput): Promise<SalesChartOutput> {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { year: input.year, monthly: months.map((month, i) => ({ month, revenueUsd: 10_000 + i * 1_250 })) };
  }
}
```

```tsx
// src/apps/main/tools/sales-chart/sales-chart.widget.tsx
import { useEffect, useRef } from 'react';

type Props = { output: { year: number; monthly: Array<{ month: string; revenueUsd: number }> } };

export default function SalesChartWidget({ output }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    // …simple bar chart, no external deps so it runs everywhere
    ctx.fillStyle = '#3b82f6';
    output.monthly.forEach((m, i) => {
      const barHeight = (m.revenueUsd / 25_000) * 280;
      ctx.fillRect(i * 28 + 8, 300 - barHeight, 20, barHeight);
    });
  }, [output]);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ margin: 0 }}>Sales — {output.year}</h2>
      <canvas ref={canvasRef} width={360} height={320} style={{ marginTop: 12 }} />
    </div>
  );
}
```

## What This Demonstrates

- Pointing `template` at a sibling `.tsx` file via the `FileSource` form `{ file: ... }`
- Anchoring the path to the tool source with `fileURLToPath(new URL('./...widget.tsx', import.meta.url))` so `process.cwd()` doesn't matter
- Leaving `resourceMode` unset — the framework host-detects (`'inline'` for Claude, `'cdn'` for others)
- Naming the widget `*.widget.tsx` so the scaffolded `tsconfig.json`'s `exclude` keeps it out of the server typecheck

## Why these defaults matter

- **`import.meta.url` anchoring** — relative paths in `FileSource` resolve against `process.cwd()`, not the tool file (#444). Running the server from a different directory breaks the widget at tool-call time. Anchoring fixes it once.
- **`resourceMode` unset** — leave it. The framework picks `'inline'` for Claude (React bundled into the widget — actually renders) and `'cdn'` for everyone else (smaller payload via esm.sh). Setting it explicitly only locks in one behavior across all clients.
- **`hydrate: false`** — default. React SSR output is static HTML; the bridge IIFE handles any interactivity. Enabling hydration creates React error #418 in Claude's iframe sandbox where the client-side render diverges from the SSR render.
- **`*.widget.tsx` naming** — the scaffolded `tsconfig.json` excludes `**/*.widget.tsx` from the server typecheck (#445). The widget compiles via uipack/esbuild at render time with its own React-aware config.
