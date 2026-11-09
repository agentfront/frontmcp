import type { RequestLogSummary } from './request-log.types';

type ContentLike = { type?: unknown; mimeType?: unknown; text?: unknown; blob?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonBytes(value: unknown): number | undefined {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  } catch {
    return undefined;
  }
}

function contentTypeOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const { type, mimeType, text, blob } = item as ContentLike;
  if (typeof mimeType === 'string') return mimeType;
  if (typeof type === 'string') return type;
  if (text !== undefined) return 'text';
  return blob !== undefined ? 'blob' : undefined;
}

function contentItemsOf(result: Record<string, unknown>): unknown[] {
  if (Array.isArray(result['content'])) return result['content'];
  if (Array.isArray(result['contents'])) return result['contents'];
  if (Array.isArray(result['messages']))
    return result['messages'].map((message) => (message as ContentLike & { content?: unknown })?.content);
  return [];
}

/** The argument names and size of a call's arguments. */
export function summarizeInput(args: unknown): RequestLogSummary {
  return { bytes: jsonBytes(args ?? {}), keys: isRecord(args) ? Object.keys(args) : [] };
}

/** The size, content types, `structuredContent` keys and error flag of a call's result. */
export function summarizeOutput(result: unknown): RequestLogSummary {
  const summary: RequestLogSummary = { bytes: jsonBytes(result) };
  if (!isRecord(result)) return summary;
  const contentTypes = contentItemsOf(result)
    .map(contentTypeOf)
    .filter((type): type is string => type !== undefined);
  summary.content_types = [...new Set(contentTypes)];
  if (isRecord(result['structuredContent'])) summary.keys = Object.keys(result['structuredContent']);
  if (Array.isArray(result['content'])) summary.is_error = result['isError'] === true;
  return summary;
}
