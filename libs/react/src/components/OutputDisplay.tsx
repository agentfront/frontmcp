/**
 * OutputDisplay — renders JSON or text output from tool/prompt calls.
 */

import React from 'react';

export interface OutputDisplayProps {
  data: unknown;
  loading?: boolean;
  error?: Error | null;
}

export function OutputDisplay({ data, loading, error }: OutputDisplayProps): React.ReactElement {
  if (loading) {
    return React.createElement('div', { 'data-testid': 'output-loading' }, 'Loading...');
  }

  if (error) {
    return React.createElement(
      'div',
      { 'data-testid': 'output-error', style: { color: 'red' } },
      `Error: ${error.message}`,
    );
  }

  if (data === null || data === undefined) {
    return React.createElement('div', { 'data-testid': 'output-empty' }, '');
  }

  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return React.createElement(
    'pre',
    { 'data-testid': 'output-display', style: { overflow: 'auto', whiteSpace: 'pre-wrap' } },
    formatted,
  );
}
