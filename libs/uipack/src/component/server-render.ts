/**
 * Server rendering of a FileSource `.tsx`/`.jsx` widget, for `ui.hydrate`.
 *
 * @packageDocumentation
 */

import { bundleFileSourceForServer } from './transpiler';

type WidgetRender = (props: Record<string, unknown>) => string;

/** The props a widget component renders with, as the page's mount gives them: `null` output and `loading` until the call's data. */
export function widgetProps(input: unknown, output: unknown): { input: unknown; output: unknown; loading: boolean } {
  const data = output === undefined || output === null ? undefined : output;
  return { input: input ?? null, output: data ?? null, loading: data === undefined };
}

const renderers = new Map<string, { source: string; render: WidgetRender }>();

/**
 * The widget rendered to HTML on the server with `props`, as the page's mount renders it, so the
 * page can hydrate it. The server bundle is built once per widget source.
 *
 * @param filePath - The widget's absolute path
 * @param source - The widget's source, which keys the bundle
 * @param exportName - The component's export, `default` when unset
 */
export function renderFileSourceOnServer(
  filePath: string,
  source: string,
  exportName: string | undefined,
  props: Record<string, unknown>,
): string {
  const key = `${filePath}#${exportName ?? 'default'}`;
  let renderer = renderers.get(key);
  if (renderer?.source !== source) {
    renderer = { source, render: loadServerBundle(filePath, exportName) };
    renderers.set(key, renderer);
  }
  return renderer.render(props);
}

function loadServerBundle(filePath: string, exportName: string | undefined): WidgetRender {
  const { code } = bundleFileSourceForServer(filePath, exportName);
  const { createRequire } = process.getBuiltinModule('node:module');
  const path = process.getBuiltinModule('node:path');
  const module = { exports: {} as { render?: WidgetRender } };
  // The widget is the tool author's code, bundled from its file; React is required from the widget's project
  const evaluate = new Function('require', 'module', 'exports', '__filename', '__dirname', code);
  evaluate(createRequire(filePath), module, module.exports, filePath, path.dirname(filePath));
  const { render } = module.exports;
  if (typeof render !== 'function') throw new Error(`The server bundle of FileSource "${filePath}" has no render()`);
  return render;
}
