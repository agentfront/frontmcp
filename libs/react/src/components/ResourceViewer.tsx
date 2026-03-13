/**
 * ResourceViewer — displays a ReadResourceResult.
 */

import React from 'react';

export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
}

export interface ResourceViewerProps {
  data: { contents?: ResourceContent[] } | null;
  loading?: boolean;
  error?: Error | null;
}

export function ResourceViewer({ data, loading, error }: ResourceViewerProps): React.ReactElement {
  if (loading) {
    return React.createElement('div', { 'data-testid': 'resource-loading' }, 'Loading...');
  }

  if (error) {
    return React.createElement(
      'div',
      { 'data-testid': 'resource-error', style: { color: 'red' } },
      `Error: ${error.message}`,
    );
  }

  if (!data || !data.contents || data.contents.length === 0) {
    return React.createElement('div', { 'data-testid': 'resource-empty' }, 'No content');
  }

  return React.createElement(
    'div',
    { 'data-testid': 'resource-viewer' },
    ...data.contents.map((content, i) =>
      React.createElement(
        'div',
        { key: `${content.uri}-${i}`, style: { marginBottom: '8px' } },
        React.createElement('div', { style: { fontSize: '0.8em', color: '#666' } }, content.uri),
        content.mimeType === 'application/json'
          ? React.createElement('pre', { style: { overflow: 'auto' } }, formatJson(content.text ?? ''))
          : React.createElement('div', null, content.text ?? ''),
      ),
    ),
  );
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
