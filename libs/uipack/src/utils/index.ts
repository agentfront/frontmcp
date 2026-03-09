/**
 * @frontmcp/uipack Utilities
 *
 * Pure TypeScript utility functions for HTML escaping and serialization.
 * No Node.js native module dependencies.
 *
 * @packageDocumentation
 */

export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      },
      space,
    );
  } catch {
    return JSON.stringify({ error: 'Output could not be serialized' });
  }
}

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) {
    return '';
  }

  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function escapeJsString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeScriptClose(jsonString: string): string {
  return jsonString.replace(/<\//g, '<\\/');
}

export function safeJsonForScript(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }

  try {
    const jsonString = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') {
        return val.toString();
      }
      return val;
    });

    if (jsonString === undefined) {
      return 'null';
    }

    return escapeScriptClose(jsonString);
  } catch {
    return '{"error":"Value could not be serialized"}';
  }
}
