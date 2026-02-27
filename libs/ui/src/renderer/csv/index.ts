import React from 'react';
import type { ContentRenderer, RenderOptions } from '../types';

function detectDelimiter(content: string): string {
  const firstLine = content.split('\n')[0];
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;

  if (tabs > commas && tabs > semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

function parseCsv(content: string, delimiter: string): string[][] {
  return content
    .trim()
    .split('\n')
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

export class CsvRenderer implements ContentRenderer {
  readonly type = 'csv';

  canHandle(content: string): boolean {
    const lines = content.trim().split('\n').slice(0, 5);
    if (lines.length < 2) return false;

    for (const delim of [',', '\t', ';']) {
      const counts = lines.map((line) => line.split(delim).length);
      if (counts[0] > 1 && counts.every((c) => c === counts[0])) return true;
    }
    return false;
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    const delimiter = detectDelimiter(content);
    const rows = parseCsv(content, delimiter);
    const [headerRow, ...dataRows] = rows;

    return React.createElement(
      'table',
      {
        className: options?.className ?? 'fmcp-csv-table',
        style: { width: '100%', borderCollapse: 'collapse' as const },
      },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          null,
          headerRow.map((cell, i) =>
            React.createElement(
              'th',
              {
                key: i,
                style: { borderBottom: '2px solid #ddd', padding: '8px', textAlign: 'left' as const },
              },
              cell,
            ),
          ),
        ),
      ),
      React.createElement(
        'tbody',
        null,
        dataRows.map((row, ri) =>
          React.createElement(
            'tr',
            { key: ri },
            row.map((cell, ci) =>
              React.createElement(
                'td',
                {
                  key: ci,
                  style: { borderBottom: '1px solid #eee', padding: '8px' },
                },
                cell,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

export const csvRenderer = new CsvRenderer();
