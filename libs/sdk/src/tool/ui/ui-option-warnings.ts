/**
 * `ui` options that the schema accepts but nothing reads yet. Declaring one is
 * not an error, but a developer who sets it expects an effect, so startup says
 * that there is none.
 */
const IGNORED_UI_OPTIONS = [
  'widgetDescription',
  'widgetAccessible',
  'displayMode',
  'prefersBorder',
  'sandboxDomain',
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

  if (mode === 'hybrid') {
    messages.push(
      `Tool "${toolName}": \`ui.servingMode: 'hybrid'\` sends only a reference in \`_meta['ui/component']\` ({ type, hash, toolName }), not the component code; the widget is rendered from its \`ui://\` resource.`,
    );
  }

  return messages;
}
