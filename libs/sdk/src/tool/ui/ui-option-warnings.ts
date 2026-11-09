import { validateCSPDomain } from '@frontmcp/uipack/shell';

/** Describe the parts of a tool's `ui` config that have no effect, one message per problem. */
export function describeIgnoredUiOptions(toolName: string, ui: Record<string, unknown> | undefined): string[] {
  if (!ui) return [];
  const messages: string[] = [];

  messages.push(...describeInvalidCspOrigins(toolName, ui['csp']));

  if (ui['servingMode'] === 'hybrid') {
    messages.push(
      `Tool "${toolName}": \`ui.servingMode: 'hybrid'\` sends only a reference in \`_meta['ui/component']\` ({ type, hash, toolName }), not the component code; the widget is rendered from its \`ui://\` resource.`,
    );
  }

  return messages;
}

/**
 * Describe a server or app `ui.servingMode` default (#720) that does not do what its name says,
 * once for every tool that inherits it rather than once per tool.
 *
 * @param owner - Where the default is set, e.g. "`@FrontMcp({ ui })`"
 * @param mode - The default, if set
 */
export function describeServingModeDefault(owner: string, mode: string | undefined): string[] {
  if (mode === 'hybrid') {
    return [
      `${owner}: \`ui.servingMode: 'hybrid'\` sends only a reference in \`_meta['ui/component']\` ({ type, hash, toolName }), not the component code; the widgets of the tools that inherit it are rendered from their \`ui://\` resource.`,
    ];
  }
  return [];
}

/**
 * The `ui.csp` origins the widget page's Content-Security-Policy cannot list, one message per
 * origin. They are left out of the policy FrontMCP writes into the page; the resource `_meta`
 * still carries them as written, for the host to judge.
 */
function describeInvalidCspOrigins(toolName: string, csp: unknown): string[] {
  if (!csp || typeof csp !== 'object') return [];
  const messages: string[] = [];
  for (const key of ['connectDomains', 'resourceDomains'] as const) {
    const domains = (csp as Record<string, unknown>)[key];
    if (!Array.isArray(domains)) continue;
    for (const domain of domains) {
      if (typeof domain === 'string' && validateCSPDomain(domain)) continue;
      messages.push(
        `Tool "${toolName}": \`ui.csp.${key}\` origin ${JSON.stringify(domain)} is not an https:// or wss:// origin ` +
          `(or http:// / ws:// on localhost), so the widget page's Content-Security-Policy leaves it out.`,
      );
    }
  }
  return messages;
}
