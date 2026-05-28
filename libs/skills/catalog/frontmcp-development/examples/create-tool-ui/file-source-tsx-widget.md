---
name: file-source-tsx-widget
reference: create-tool-ui
level: advanced
description: "A `.tsx` FileSource widget that bundles a React chart component for OpenAI Apps SDK / ChatGPT / MCP Inspector (Claude support is currently broken — see #447 / #454 — use a self-contained `uiType: 'html'` template for Claude targets)."
tags: [development, tool, ui, widget, file-source, tsx, react, cdn, mcp-apps]
features:
  - 'Pointing `template` at a sibling `.tsx` file via the `FileSource` form: `{ file: ... }`'
  - 'Resolving the file path relative to the tool source (not `process.cwd()`) using `import.meta.url`'
  - 'Excluding `chart.js` from the bundle via `externals` and pinning a CDN URL with `dependencies`'
  - "Setting `resourceMode: 'inline'` so the renderer runtime scripts are embedded (helps OpenAI / Inspector reliability)"
  - 'Setting `hydrate: false` (default) to avoid React error #418 inside the host iframe'
  - 'Acknowledging the Claude target limitation: `.tsx` FileSource currently hangs on "Loading widget…" because the iframe blocks all external script execution including cdnjs'
---

# File-Based `.tsx` Widget with CDN Externals

A `.tsx` FileSource widget that bundles a React chart component for OpenAI Apps SDK / ChatGPT / MCP Inspector (Claude support is currently broken — see #447 / #454 — use a self-contained `uiType: 'html'` template for Claude targets).

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
    // `chart.js` is loaded from a CDN at runtime instead of bundled. cdnjs is
    // a sensible default; esm.sh is the framework default if you don't override.
    // (NOTE — issues #447 / #454: Claude's widget iframe blocks ALL external
    // script execution, including cdnjs. This example renders in OpenAI Apps
    // SDK, ChatGPT, and MCP Inspector but currently hangs on "Loading widget…"
    // in Claude. Use a self-contained `uiType: 'html'` template for Claude.)
    externals: ['chart.js'],
    dependencies: {
      'chart.js': {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
        global: 'Chart',
      },
    },
    // Embed the renderer runtime scripts inline (helps OpenAI / Inspector
    // reliability on widget restart; does not unblock Claude — see note above).
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
- Setting `resourceMode: 'inline'` so the renderer runtime scripts are embedded (helps OpenAI / Inspector reliability)
- Setting `hydrate: false` (default) to avoid React error #418 inside the host iframe
- Acknowledging the Claude target limitation: `.tsx` FileSource currently hangs on "Loading widget…" because the iframe blocks all external script execution including cdnjs

## Related

- See `create-tool-ui` for the full FileSource, CDN, and platform-compatibility reference
- See `create-tool` for the underlying `@Tool` decorator
