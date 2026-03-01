import React, { Suspense } from 'react';
import { detectContentType as detectBaseType, type RuntimeContentType } from '../runtime/content-detector';
import type { RenderOptions, ContentRenderer, ContentType } from './types';

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

// ============================================
// Priority-Sorted Renderer Registry
// ============================================

const rendererRegistry: ContentRenderer[] = [];
const rendererByType = new Map<string, ContentRenderer>();

function sortRegistry(): void {
  rendererRegistry.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Register a content renderer. Higher priority renderers are checked first.
 */
export function registerRenderer(renderer: ContentRenderer): void {
  rendererRegistry.push(renderer);
  rendererByType.set(renderer.type, renderer);
  sortRegistry();
}

/**
 * Get a renderer by content type string.
 */
export function getRenderer(type: string): ContentRenderer | undefined {
  return rendererByType.get(type);
}

/**
 * Get all registered renderers (sorted by priority, descending).
 */
export function getRegisteredRenderers(): readonly ContentRenderer[] {
  return rendererRegistry;
}

/**
 * Render content by auto-detecting type and finding a matching renderer.
 */
export function renderContent(content: string, options?: RenderOptions): React.ReactElement {
  const type = detectContentType(content);

  // First pass: use canHandle (respects priority order)
  for (const renderer of rendererRegistry) {
    if (renderer.canHandle(content)) {
      return renderer.render(content, options);
    }
  }

  // Second pass: exact type match
  const exact = rendererByType.get(type);
  if (exact) {
    return exact.render(content, options);
  }

  throw new Error(`No renderer found for content type: ${type}`);
}

// ============================================
// ContentView Component
// ============================================

export interface ContentViewProps {
  content: string;
  options?: RenderOptions;
  fallback?: React.ReactNode;
}

/**
 * React component that auto-detects content type and renders it
 * with Suspense boundary for lazy-loaded renderers.
 */
export function ContentView({ content, options, fallback }: ContentViewProps): React.ReactElement {
  return React.createElement(
    Suspense,
    { fallback: fallback ?? React.createElement('div', { className: 'fmcp-content-loading' }, 'Loading...') },
    React.createElement(ContentViewInner, { content, options }),
  );
}

function ContentViewInner({ content, options }: Omit<ContentViewProps, 'fallback'>): React.ReactElement {
  return renderContent(content, options);
}

export { registerRenderer as addRenderer };
export type { ContentType };
