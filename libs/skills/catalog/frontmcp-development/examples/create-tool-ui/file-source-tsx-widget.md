---
name: file-source-tsx-widget
reference: create-tool-ui
level: advanced
description: "A `.tsx` FileSource widget that bundles a React chart component and renders in every host — including Claude — by setting `resourceMode: 'inline'` so React is inlined into the widget (#454)."
tags: [development, tool, ui, widget, file-source, tsx, react, cdn, mcp-apps, claude]
features:
  - 'Pointing `template` at a sibling `.tsx` file via the `FileSource` form: `{ file: ... }`'
  - 'Resolving the file path relative to the tool source (not `process.cwd()`) using `import.meta.url`'
  - 'Excluding `chart.js` from the bundle via `externals` and pinning a CDN URL with `dependencies`'
  - "Setting `resourceMode: 'inline'` so React is bundled into the widget (no esm.sh import map) — makes the widget self-contained and renders in Claude (#454)"
  - 'Setting `hydrate: false` (default) to avoid React error #418 inside the host iframe'
---

# File-Based `.tsx` Widget with CDN Externals

A `.tsx` FileSource widget that bundles a React chart component and renders in every host — including Claude — by setting `resourceMode: 'inline'` so React is inlined into the widget (#454).

## Code

```typescript
// src/apps/main/tools/sales-chart.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  year: z.number().int().min(2000).max(2100),
};

export const outputSchema = {
  year: z.number(),
  monthly: z.array(z.object({ month: z.string(), revenueUsd: z.number() })),
};

export type SalesChartInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type SalesChartOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/sales-chart.tool.ts
import { fileURLToPath } from 'node:url';

import { Tool, ToolContext } from '@frontmcp/sdk';

import { inputSchema, outputSchema, type SalesChartInput, type SalesChartOutput } from './sales-chart.schema';

// Resolve the sibling .tsx widget by absolute path. `template: { file: './x.tsx' }`
// is resolved against `process.cwd()` today (issue #444), so anchor to this file.
const widgetPath = fileURLToPath(new URL('./sales-chart.widget.tsx', import.meta.url));

@Tool({
  name: 'sales_chart',
  description: 'Render a yearly sales bar chart',
  inputSchema,
  outputSchema,
  ui: {
    widgetDescription: 'Monthly revenue chart',
    template: { file: widgetPath },
    // `chart.js` is loaded from a CDN at runtime instead of bundled.
    externals: ['chart.js'],
    dependencies: {
      'chart.js': {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
        global: 'Chart',
      },
    },
    // `resourceMode: 'inline'` makes the widget self-contained: React and
    // ReactDOM are bundled into the widget's <script type="module"> instead of
    // being loaded via an esm.sh import map. This is what lets the widget
    // render in Claude (whose sandboxed iframe blocks all external scripts —
    // see #454). The default 'cdn' mode is fine for OpenAI Apps SDK /
    // ChatGPT / MCP Inspector (smaller payload).
    resourceMode: 'inline',
    // Static HTML only — no React hydration to dodge error #418 in iframe sandboxes.
    hydrate: false,
  },
})
class SalesChartTool extends ToolContext {
  async execute(input: SalesChartInput): Promise<SalesChartOutput> {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      year: input.year,
      monthly: months.map((month, i) => ({ month, revenueUsd: 10_000 + i * 1_250 })),
    };
  }
}

export { SalesChartTool };
```

```tsx
// src/apps/main/tools/sales-chart.widget.tsx
import type { Chart as ChartType } from 'chart.js';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    Chart?: typeof ChartType;
  }
}

type Props = {
  output: { year: number; monthly: Array<{ month: string; revenueUsd: number }> };
};

export default function SalesChartWidget({ output }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ChartCtor = window.Chart;
    if (!ChartCtor || !canvasRef.current) return;
    const chart = new ChartCtor(canvasRef.current, {
      type: 'bar',
      data: {
        labels: output.monthly.map((m) => m.month),
        datasets: [{ label: `Revenue ${output.year}`, data: output.monthly.map((m) => m.revenueUsd) }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
    return () => chart.destroy();
  }, [output]);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ margin: 0 }}>Sales — {output.year}</h2>
      <div style={{ height: 320, marginTop: 12 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { SalesChartTool } from './tools/sales-chart.tool';

@App({
  name: 'main',
  tools: [SalesChartTool],
})
class MainApp {}

export { MainApp };
```

## What This Demonstrates

- Pointing `template` at a sibling `.tsx` file via the `FileSource` form: `{ file: ... }`
- Resolving the file path relative to the tool source (not `process.cwd()`) using `import.meta.url`
- Excluding `chart.js` from the bundle via `externals` and pinning a CDN URL with `dependencies`
- Setting `resourceMode: 'inline'` so React is bundled into the widget (no esm.sh import map) — makes the widget self-contained and renders in Claude (#454)
- Setting `hydrate: false` (default) to avoid React error #418 inside the host iframe

## Related

- See `create-tool-ui` for the full FileSource, CDN, and platform-compatibility reference
- See `create-tool` for the underlying `@Tool` decorator
