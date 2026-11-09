/**
 * React on the server, for templates rendered there: an MDX template, and a React component with
 * `ui.uiType: 'react'`.
 *
 * @packageDocumentation
 */

import { widgetProps } from '../component/server-render';
import { requireFromProject } from './project-require';

export interface ReactApi {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
}

interface ReactDomServer {
  renderToStaticMarkup(element: unknown): string;
}

/** React, its JSX runtime and react-dom/server, from the server's project, so templates and the renderer share one React. */
export function loadServerReact(purpose: string): { react: ReactApi; jsxRuntime: unknown; server: ReactDomServer } {
  return {
    react: requireFromProject<ReactApi>('react', purpose),
    jsxRuntime: requireFromProject<unknown>('react/jsx-runtime', purpose),
    server: requireFromProject<ReactDomServer>('react-dom/server', purpose),
  };
}

/** A React component reference rendered to static HTML on the server, with the widget props. */
export function renderComponentOnServer(component: unknown, input: unknown, output: unknown): string {
  const { react, server } = loadServerReact("`ui.uiType: 'react'`");
  return server.renderToStaticMarkup(react.createElement(component, widgetProps(input, output)));
}
