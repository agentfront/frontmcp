/**
 * McpNavigation — nav component linking to tool/resource/prompt routes.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useFrontMcp } from '../hooks/useFrontMcp';

export interface McpNavigationProps {
  basePath?: string;
}

export function McpNavigation({ basePath = '/mcp' }: McpNavigationProps): React.ReactElement {
  const normalizedBase = basePath.replace(/\/+$/, '') || '/';
  const { tools, resources, prompts, status, error } = useFrontMcp();

  if (status === 'error') {
    return React.createElement(
      'nav',
      null,
      React.createElement('em', null, `Connection error: ${error?.message ?? 'unknown'}`),
    );
  }
  if (status !== 'connected') {
    return React.createElement('nav', null, React.createElement('em', null, 'Connecting...'));
  }

  return React.createElement(
    'nav',
    null,
    tools.length > 0 &&
      React.createElement(
        'div',
        null,
        React.createElement('h4', null, 'Tools'),
        React.createElement(
          'ul',
          null,
          ...tools.map((t) =>
            React.createElement(
              'li',
              { key: t.name },
              React.createElement(Link, { to: `${normalizedBase}/tools/${encodeURIComponent(t.name)}` }, t.name),
            ),
          ),
        ),
      ),
    resources.length > 0 &&
      React.createElement(
        'div',
        null,
        React.createElement('h4', null, 'Resources'),
        React.createElement(
          'ul',
          null,
          ...resources.map((r) =>
            React.createElement(
              'li',
              { key: r.uri },
              React.createElement(
                Link,
                { to: `${normalizedBase}/resources/${encodeURIComponent(r.uri)}` },
                r.name ?? r.uri,
              ),
            ),
          ),
        ),
      ),
    prompts.length > 0 &&
      React.createElement(
        'div',
        null,
        React.createElement('h4', null, 'Prompts'),
        React.createElement(
          'ul',
          null,
          ...prompts.map((p) =>
            React.createElement(
              'li',
              { key: p.name },
              React.createElement(Link, { to: `${normalizedBase}/prompts/${encodeURIComponent(p.name)}` }, p.name),
            ),
          ),
        ),
      ),
  );
}
