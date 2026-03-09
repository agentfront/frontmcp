/**
 * Content Type Detector
 *
 * Auto-detects the content type from a template result value.
 *
 * @packageDocumentation
 */

/**
 * Detected content types from template output.
 */
export type DetectedContentType = 'chart' | 'mermaid' | 'pdf' | 'html' | 'text' | 'json';

const CHART_TYPES = new Set(['bar', 'line', 'pie', 'area', 'scatter', 'doughnut', 'radar', 'polarArea', 'bubble']);

const MERMAID_PREFIXES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'gitGraph',
  'journey',
  'mindmap',
  'timeline',
  'quadrantChart',
  'sankey',
  'xychart',
];

/** Base64 magic bytes for PDF (%PDF → JVBERi) */
const PDF_MAGIC = 'JVBERi';

/**
 * Detect content type from a template result value.
 *
 * @param value - The raw template output
 * @returns The detected content type
 */
export function detectContentType(value: unknown): DetectedContentType {
  if (value === null || value === undefined) {
    return 'text';
  }

  // Object with chart-like shape
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj['type'] === 'string' && CHART_TYPES.has(obj['type'])) {
      return 'chart';
    }
    return 'json';
  }

  if (typeof value === 'string') {
    const trimmed = value.trimStart();

    // PDF base64
    if (trimmed.startsWith(PDF_MAGIC)) {
      return 'pdf';
    }

    // Mermaid diagram
    for (const prefix of MERMAID_PREFIXES) {
      if (trimmed.startsWith(prefix)) {
        return 'mermaid';
      }
    }

    // HTML content
    if (trimmed.includes('<') && trimmed.includes('>')) {
      return 'html';
    }

    return 'text';
  }

  return 'text';
}
