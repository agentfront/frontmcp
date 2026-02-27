import type { ReactElement } from 'react';
import { detectContentType as detectBaseType, type RuntimeContentType } from '../runtime/content-detector';
import type { RenderOptions, ContentRenderer } from './types';

export type DetectedContentType = RuntimeContentType | 'pdf' | 'csv';

const PDF_HEADER = '%PDF-';
const BASE64_PDF_PREFIX = 'JVBER';

function isPdf(content: string): boolean {
  if (content.startsWith(PDF_HEADER)) return true;
  const trimmed = content.trim();
  return trimmed.startsWith(BASE64_PDF_PREFIX) || /^data:application\/pdf[;,]/.test(trimmed);
}

function isCsv(content: string): boolean {
  const lines = content.trim().split('\n').slice(0, 5);
  if (lines.length < 2) return false;

  for (const delim of [',', '\t', ';']) {
    const counts = lines.map((line) => line.split(delim).length);
    if (counts[0] > 1 && counts.every((c) => c === counts[0])) return true;
  }
  return false;
}

export function detectContentType(content: string): DetectedContentType {
  if (isPdf(content)) return 'pdf';
  if (isCsv(content)) return 'csv';
  return detectBaseType(content);
}

const rendererRegistry: ContentRenderer[] = [];

export function registerRenderer(renderer: ContentRenderer): void {
  rendererRegistry.push(renderer);
}

export function renderContent(content: string, options?: RenderOptions): ReactElement {
  const type = detectContentType(content);

  for (const renderer of rendererRegistry) {
    if (renderer.canHandle(content)) {
      return renderer.render(content, options);
    }
  }

  // Fallback: try each renderer's canHandle
  for (const renderer of rendererRegistry) {
    if (renderer.type === type) {
      return renderer.render(content, options);
    }
  }

  throw new Error(`No renderer found for content type: ${type}`);
}

export { registerRenderer as addRenderer };
