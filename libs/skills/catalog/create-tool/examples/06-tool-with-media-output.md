---
name: 06-tool-with-media-output
level: intermediate
description: "Tool returning binary content (image / audio) or a multi-content array of `[text, image]` — for outputs that aren't plain JSON."
tags: [output-schema, media-output, image, multi-content]
features:
  - "Returning a base64-encoded image with `outputSchema: 'image'` and `{ type: 'image', data, mimeType }`"
  - "Returning audio with `outputSchema: 'audio'` (same `{ type: 'audio', data, mimeType }` shape, audio MIME types)"
  - "Returning multi-content via `outputSchema: ['string', 'image']` — text summary + annotated image in one response"
  - "When to pick a media literal vs `'resource_link'` (host-fetched URI)"
---

# Tool With Media Output

Tool returning binary content (image / audio) or a multi-content array of `[text, image]` — for outputs that aren't plain JSON.

Media outputs use the literal forms: `'image'`, `'audio'`, `'resource'`, `'resource_link'`, or a mixed array like `['string', 'image']`.

## Code

```typescript
// src/apps/main/tools/render-chart.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// 1. Image output — base64-encoded
@Tool({
  name: 'render_chart',
  description: 'Render a bar chart as PNG',
  inputSchema: {
    labels: z.array(z.string()),
    values: z.array(z.number()),
  },
  outputSchema: 'image',
})
export class RenderChartTool extends ToolContext {
  async execute(input: { labels: string[]; values: number[] }) {
    const pngBuffer = await this.renderPng(input);
    return {
      type: 'image' as const, // required — without it the content block is dropped
      data: pngBuffer.toString('base64'),
      mimeType: 'image/png' as const,
    };
  }

  private async renderPng(_input: { labels: string[]; values: number[] }): Promise<Buffer> {
    return Buffer.from('iVBORw0KGgo…', 'base64'); // tiny placeholder
  }
}

// 2. Audio output
@Tool({
  name: 'tts',
  description: 'Synthesize speech from text',
  inputSchema: { text: z.string() },
  outputSchema: 'audio',
})
export class TtsTool extends ToolContext {
  async execute(input: { text: string }) {
    const wavBuffer = await this.synthesize(input.text);
    return {
      type: 'audio' as const, // required — without it the content block is dropped
      data: wavBuffer.toString('base64'),
      mimeType: 'audio/wav' as const,
    };
  }

  private async synthesize(_text: string): Promise<Buffer> {
    return Buffer.alloc(0);
  }
}

// 3. Multi-content — text summary + annotated image
@Tool({
  name: 'analyze_image',
  description: 'Detect objects and return a summary + annotated image',
  inputSchema: { imageUrl: z.string().url() },
  outputSchema: ['string', 'image'],
})
export class AnalyzeImageTool extends ToolContext {
  async execute(input: { imageUrl: string }) {
    const detection = await this.detect(input.imageUrl);
    const summary = `Detected: ${detection.objects.join(', ')}.`;
    const annotated = await this.annotate(input.imageUrl, detection);
    return [
      summary,
      { type: 'image' as const, data: annotated.toString('base64'), mimeType: 'image/png' as const },
    ] as const;
  }

  private async detect(_url: string) {
    return { objects: ['cat', 'laptop'] };
  }
  private async annotate(_url: string, _d: { objects: string[] }): Promise<Buffer> {
    return Buffer.alloc(0);
  }
}
```

## What This Demonstrates

- Returning a base64-encoded image with `outputSchema: 'image'` and `{ type: 'image', data, mimeType }`
- Returning audio with `outputSchema: 'audio'` (same `{ type: 'audio', data, mimeType }` shape, audio MIME types)
- Returning multi-content via `outputSchema: ['string', 'image']` — text summary + annotated image in one response
- When to pick a media literal vs `'resource_link'` (host-fetched URI)

## Media literal vs `'resource_link'`

- **`'image'` / `'audio'`** — inlines the bytes (base64) in the response. Best for small payloads (< ~1 MB). Simple — the client gets the data immediately.
- **`'resource_link'`** — returns `{ uri: 'custom://…' }`; the client calls `resources/read` to fetch. Best for large payloads or when caching matters — see [`26-tool-with-resource-link-output`](./26-tool-with-resource-link-output.md).
