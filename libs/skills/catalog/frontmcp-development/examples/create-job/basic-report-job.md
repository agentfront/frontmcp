---
name: basic-report-job
reference: create-job
level: basic
description: 'A minimal job that generates a report with progress tracking and structured output.'
tags: [development, job, report]
features:
  - 'Defining a job with `@Job` decorator including `inputSchema`, `outputSchema`, and `timeout`'
  - 'Reporting progress at each stage using `this.progress(pct, total, message)`'
  - 'Using `this.log()` for persistent, queryable log entries'
---

# Basic Report Generation Job

A minimal job that generates a report with progress tracking and structured output.

## Code

```typescript
// src/jobs/generate-report.job.ts
import { Job, JobContext, z } from '@frontmcp/sdk';

@Job({
  name: 'generate-report',
  description: 'Generate a PDF report from data',
  inputSchema: {
    reportType: z.enum(['sales', 'inventory', 'users']).describe('Type of report'),
    dateRange: z.object({
      from: z.string().describe('Start date (ISO 8601)'),
      to: z.string().describe('End date (ISO 8601)'),
    }),
    format: z.enum(['pdf', 'csv']).default('pdf').describe('Output format'),
  },
  outputSchema: {
    url: z.string().url(),
    pageCount: z.number().int(),
    generatedAt: z.string(),
  },
  timeout: 120000,
})
class GenerateReportJob extends JobContext {
  async execute(input: {
    reportType: 'sales' | 'inventory' | 'users';
    dateRange: { from: string; to: string };
    format: 'pdf' | 'csv';
  }) {
    this.log(`Starting ${input.reportType} report generation`);

    this.progress(10, 100, 'Fetching data');
    const data = await this.fetchReportData(input.reportType, input.dateRange);

    this.progress(50, 100, 'Generating document');
    const document = await this.buildDocument(data, input.format);

    this.progress(90, 100, 'Uploading');
    const url = await this.uploadDocument(document);

    this.progress(100, 100, 'Complete');
    return {
      url,
      pageCount: document.pages,
      generatedAt: new Date().toISOString(),
    };
  }

  private async fetchReportData(type: string, range: { from: string; to: string }) {
    return { rows: [], count: 0 };
  }
  private async buildDocument(data: unknown, format: string) {
    return { pages: 5, buffer: Buffer.alloc(0) };
  }
  private async uploadDocument(doc: { buffer: Buffer }) {
    return 'https://storage.example.com/reports/report-001.pdf';
  }
}
```

## What This Demonstrates

- Defining a job with `@Job` decorator including `inputSchema`, `outputSchema`, and `timeout`
- Reporting progress at each stage using `this.progress(pct, total, message)`
- Using `this.log()` for persistent, queryable log entries

## Related

- See `create-job` for the full API reference including retry policies and permissions
