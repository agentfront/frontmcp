---
name: file-source-tsx-widget
reference: create-tool-ui
level: advanced
description: 'A `.tsx` FileSource widget that loads `chart.js` from `cdnjs.cloudflare.com` so it works in both OpenAI and Claude.'
tags: [development, tool, ui, widget, file-source, tsx, react, claude, cdn, mcp-apps]
features:
  - 'Pointing `template` at a sibling `.tsx` file via the `FileSource` form: `{ file: ... }`'
  - 'Resolving the file path relative to the tool source (not `process.cwd()`) using `import.meta.url`'
  - 'Excluding `chart.js` from the bundle via `externals` and pinning a Claude-compatible CDN URL with `dependencies`'
  - "Setting `resourceMode: 'inline'` so renderer scripts are embedded — required for Claude Artifacts"
  - 'Setting `hydrate: false` (default) to avoid React error #418 inside the host iframe'
---

# File-Based `.tsx` Widget with CDN Externals

A `.tsx` FileSource widget that loads `chart.js` from `cdnjs.cloudflare.com` so it works in both OpenAI and Claude.

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
    // `chart.js` is loaded from CDN at runtime instead of bundled.
    externals: ['chart.js'],
    dependencies: {
      'chart.js': {
        // Only cdnjs.cloudflare.com is reachable from Claude Artifacts.
        url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
        global: 'Chart',
      },
    },
    // Embed the renderer scripts inline so the widget is self-contained for Claude.
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
- Excluding `chart.js` from the bundle via `externals` and pinning a Claude-compatible CDN URL with `dependencies`
- Setting `resourceMode: 'inline'` so renderer scripts are embedded — required for Claude Artifacts
- Setting `hydrate: false` (default) to avoid React error #418 inside the host iframe

## Related

- See `create-tool-ui` for the full FileSource, CDN, and platform-compatibility reference
- See `create-tool` for the underlying `@Tool` decorator
