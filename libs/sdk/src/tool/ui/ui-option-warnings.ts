import { validateCSPDomain } from '@frontmcp/uipack/shell';

/**
 * `ui` options that the schema accepts but nothing reads yet. Declaring one is
 * not an error, but a developer who sets it expects an effect, so startup says
 * that there is none.
 */
const IGNORED_UI_OPTIONS = [
  'contentSecurity',
  'hydrate',
  'runtimeOptions',
  'mdxComponents',
  'bundlingMode',
  'uiType',
  'htmlResponsePrefix',
] as const;

const UNSUPPORTED_SERVING_MODES = ['direct-url', 'custom-url'] as const;

/** Describe the parts of a tool's `ui` config that have no effect, one message per problem. */
export function describeIgnoredUiOptions(toolName: string, ui: Record<string, unknown> | undefined): string[] {
  if (!ui) return [];
  const messages: string[] = [];

  const ignored = IGNORED_UI_OPTIONS.filter((key) => ui[key] !== undefined);
  if (ignored.length > 0) {
    messages.push(
      `Tool "${toolName}": \`ui.${ignored.join('`, `ui.')}\` ${
        ignored.length === 1 ? 'is' : 'are'
      } accepted but not used yet, so ${ignored.length === 1 ? 'it has' : 'they have'} no effect.`,
    );
  }

  const mode = ui['servingMode'];
  if ((UNSUPPORTED_SERVING_MODES as readonly unknown[]).includes(mode)) {
    messages.push(
      `Tool "${toolName}": \`ui.servingMode: '${String(mode)}'\` is not implemented; the widget is served inline, as with \`servingMode: 'inline'\`.`,
    );
  }

  messages.push(...describeInvalidCspOrigins(toolName, ui['csp']));

  if (mode === 'hybrid') {
    messages.push(
      `Tool "${toolName}": \`ui.servingMode: 'hybrid'\` sends only a reference in \`_meta['ui/component']\` ({ type, hash, toolName }), not the component code; the widget is rendered from its \`ui://\` resource.`,
    );
  }

  return messages;
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
