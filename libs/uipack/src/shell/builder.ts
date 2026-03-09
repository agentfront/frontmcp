/**
 * Shell Builder
 *
 * Generates HTML documents (shells) that wrap UI widget content
 * with CSP, data injection, and optional bridge runtime.
 *
 * @packageDocumentation
 */

import type { ShellConfig, ShellResult } from './types';
import type { ResolvedShellTemplate } from './custom-shell-types';
import { buildCSPMetaTag } from './csp';
import { buildDataInjectionScript } from './data-injector';
import { generateBridgeIIFE } from '../bridge-runtime';
import { validateShellTemplate } from './custom-shell-validator';
import { applyShellTemplate } from './custom-shell-applier';

/**
 * Build an HTML shell wrapping the provided content.
 *
 * When `withShell: false`, returns just the content with data injection prepended.
 * When `withShell: true` (default), returns a full HTML document.
 *
 * @example
 * ```typescript
 * const result = buildShell('<div id="root">Hello</div>', {
 *   toolName: 'my_tool',
 *   output: { message: 'Hello World' },
 * });
 *
 * // result.html is a complete HTML document with:
 * // - CSP meta tag
 * // - Data injection script
 * // - Bridge runtime
 * // - The content in <body>
 * ```
 */
export function buildShell(content: string, config: ShellConfig): ShellResult {
  const { toolName, csp, withShell = true, input, output, structuredContent, includeBridge = true, title } = config;

  const { customShell } = config;
  const dataScript = buildDataInjectionScript({ toolName, input, output, structuredContent });

  if (!withShell) {
    // Shell-less mode: just data injection + content (custom shell ignored)
    const html = `${dataScript}\n${content}`;
    return {
      html,
      hash: simpleHash(html),
      size: Buffer.byteLength(html, 'utf-8'),
    };
  }

  // Custom shell mode: use placeholder-based template
  if (customShell) {
    return buildCustomShell(content, customShell, {
      csp,
      toolName,
      input,
      output,
      structuredContent,
      includeBridge,
      title,
    });
  }

  // Default full shell mode
  const headParts: string[] = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  ];

  if (title) {
    headParts.push(`<title>${escapeHtmlForTag(title)}</title>`);
  }

  // CSP meta tag
  headParts.push(buildCSPMetaTag(csp));

  // Data injection
  headParts.push(dataScript);

  // Bridge runtime
  if (includeBridge) {
    const bridgeScript = generateBridgeIIFE({ minify: true });
    headParts.push(`<script>${bridgeScript}</script>`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
${headParts.map((p) => `  ${p}`).join('\n')}
</head>
<body>
${content}
</body>
</html>`;

  return {
    html,
    hash: simpleHash(html),
    size: Buffer.byteLength(html, 'utf-8'),
  };
}

/**
 * Build HTML using a custom shell template with placeholder replacement.
 */
function buildCustomShell(
  content: string,
  customShell: ResolvedShellTemplate | string,
  ctx: {
    csp?: ShellConfig['csp'];
    toolName: string;
    input?: unknown;
    output?: unknown;
    structuredContent?: unknown;
    includeBridge: boolean;
    title?: string;
  },
): ShellResult {
  let template: string;

  if (typeof customShell === 'string') {
    // Inline string: validate on the fly
    const validation = validateShellTemplate(customShell);
    if (!validation.valid) {
      throw new Error(
        `Custom shell template is missing required placeholder(s): ${validation.missingRequired.map((n) => `{{${n}}}`).join(', ')}`,
      );
    }
    template = customShell;
  } else {
    template = customShell.template;
  }

  const cspTag = buildCSPMetaTag(ctx.csp);
  const dataScript = buildDataInjectionScript({
    toolName: ctx.toolName,
    input: ctx.input,
    output: ctx.output,
    structuredContent: ctx.structuredContent,
  });

  let bridgeHtml = '';
  if (ctx.includeBridge) {
    const bridgeScript = generateBridgeIIFE({ minify: true });
    bridgeHtml = `<script>${bridgeScript}</script>`;
  }

  const html = applyShellTemplate(template, {
    csp: cspTag,
    data: dataScript,
    bridge: bridgeHtml,
    content,
    title: ctx.title ? escapeHtmlForTag(ctx.title) : '',
  });

  return {
    html,
    hash: simpleHash(html),
    size: Buffer.byteLength(html, 'utf-8'),
  };
}

/**
 * Simple string hash for cache keys. Not cryptographic.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function escapeHtmlForTag(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
