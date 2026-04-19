---
name: primitive-and-media-outputs
reference: create-tool-output-schema-types
level: intermediate
description: 'Demonstrates using primitive string literals and media types as `outputSchema` for tools that return plain text, images, or multi-content arrays.'
tags: [development, output-schema, tool, output, schema, types]
features:
  - "Using `'string'` literal to return plain text output"
  - "Using `'image'` literal to return base64 image data"
  - "Using `['string', 'image']` array to return multi-content (text plus image) in a single response"
  - "Other available primitives: `'number'`, `'boolean'`, `'date'`"
  - "Other available media types: `'audio'`, `'resource'`, `'resource_link'`"
---

# Primitive Literal and Media Type Output Schemas

Demonstrates using primitive string literals and media types as `outputSchema` for tools that return plain text, images, or multi-content arrays.

## Code

```typescript
// src/tools/summarize.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// Primitive literal: returns plain text
@Tool({
  name: 'summarize_text',
  description: 'Summarize a long text into a short paragraph',
  inputSchema: {
    text: z.string().describe('The text to summarize'),
  },
  outputSchema: 'string',
})
class SummarizeTextTool extends ToolContext {
  async execute(input: { text: string }) {
    const summary = await this.get(LlmService).summarize(input.text);
    return summary;
  }
}
```

```typescript
// src/tools/generate-chart.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// Media type: returns base64 image data
@Tool({
  name: 'generate_chart',
  description: 'Generate a chart image from data points',
  inputSchema: {
    data: z.array(z.object({ label: z.string(), value: z.number() })),
    chartType: z.enum(['bar', 'line', 'pie']),
  },
  outputSchema: 'image',
})
class GenerateChartTool extends ToolContext {
  async execute(input: { data: Array<{ label: string; value: number }>; chartType: string }) {
    const chartService = this.get(ChartService);
    const imageBase64 = await chartService.render(input.data, input.chartType);
    return imageBase64;
  }
}
```

```typescript
// src/tools/analyze-document.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// Multi-content array: returns text + image
@Tool({
  name: 'analyze_document',
  description: 'Analyze a document and return summary with visual highlights',
  inputSchema: {
    documentId: z.string().describe('Document ID to analyze'),
  },
  outputSchema: ['string', 'image'],
})
class AnalyzeDocumentTool extends ToolContext {
  async execute(input: { documentId: string }) {
    const doc = this.get(DocumentService);
    const analysis = await doc.analyze(input.documentId);
    return {
      text: analysis.summary,
      image: analysis.highlightImageBase64,
    };
  }
}
```

## What This Demonstrates

- Using `'string'` literal to return plain text output
- Using `'image'` literal to return base64 image data
- Using `['string', 'image']` array to return multi-content (text plus image) in a single response
- Other available primitives: `'number'`, `'boolean'`, `'date'`
- Other available media types: `'audio'`, `'resource'`, `'resource_link'`

## Related

- See `create-tool-output-schema-types` for the complete list of supported output schema types
- See `decorators-guide` for the full `@Tool` decorator field reference
