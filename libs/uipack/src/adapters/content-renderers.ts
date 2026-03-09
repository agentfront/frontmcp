/**
 * Content Renderers
 *
 * Content-type-specific HTML generators using CDN imports.
 *
 * @packageDocumentation
 */

import { buildShell } from '../shell/builder';
import { safeJsonForScript, escapeHtml } from '../utils';
import { detectContentType } from './content-detector';

const CHART_JS_CDN = 'https://esm.sh/chart.js@4/auto';
const MERMAID_CDN = 'https://esm.sh/mermaid@11/dist/mermaid.esm.min.mjs';

/**
 * Build HTML for a Chart.js chart.
 */
export function buildChartHtml(chartJson: Record<string, unknown>): string {
  const chartData = safeJsonForScript(chartJson);

  const content = `
<canvas id="chart" style="max-width:100%;max-height:80vh;"></canvas>
<script type="module">
import Chart from '${CHART_JS_CDN}';
const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, ${chartData});
</script>`;

  const result = buildShell(content, {
    toolName: 'chart',
    csp: {
      resourceDomains: ['https://esm.sh'],
      connectDomains: ['https://esm.sh'],
    },
    includeBridge: false,
  });

  return result.html;
}

/**
 * Build HTML for a Mermaid diagram.
 */
export function buildMermaidHtml(mermaidCode: string): string {
  const escaped = escapeHtml(mermaidCode);

  const content = `
<pre class="mermaid">${escaped}</pre>
<script type="module">
import mermaid from '${MERMAID_CDN}';
mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>`;

  const result = buildShell(content, {
    toolName: 'mermaid',
    csp: {
      resourceDomains: ['https://esm.sh'],
      connectDomains: ['https://esm.sh'],
    },
    includeBridge: false,
  });

  return result.html;
}

/**
 * Build HTML for a PDF rendered via PDF.js canvas (sandbox-safe).
 */
export function buildPdfHtml(base64: string): string {
  const content = `
<div id="pdf-container" style="width:100%;overflow:auto;text-align:center;"></div>
<script type="module">
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4/build/pdf.worker.min.mjs';

const base64 = ${JSON.stringify(base64)};
const binaryStr = atob(base64);
const bytes = new Uint8Array(binaryStr.length);
for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
const container = document.getElementById('pdf-container');
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.marginBottom = '8px';
  container.appendChild(canvas);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}
</script>`;

  const result = buildShell(content, {
    toolName: 'pdf',
    csp: {
      resourceDomains: ['https://esm.sh'],
      connectDomains: ['https://esm.sh'],
    },
    includeBridge: false,
  });

  return result.html;
}

/**
 * Auto-detect content type and wrap in appropriate HTML.
 *
 * @param value - The raw template output
 * @returns HTML string or undefined if value is plain text/json (no wrapping needed)
 */
export function wrapDetectedContent(value: unknown): string | undefined {
  const contentType = detectContentType(value);

  switch (contentType) {
    case 'chart':
      return buildChartHtml(value as Record<string, unknown>);
    case 'mermaid':
      return buildMermaidHtml(value as string);
    case 'pdf':
      return buildPdfHtml(value as string);
    case 'html':
      // Return undefined so the caller wraps HTML fragments in buildShell
      // (chart/mermaid/pdf already include buildShell wrapping)
      return undefined;
    default:
      return undefined;
  }
}
