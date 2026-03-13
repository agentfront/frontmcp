/**
 * @jest-environment node
 */

import { readDomById, readDomBySelector } from '../DomResources';

describe('DomResources SSR (no document)', () => {
  it('readDomById returns SSR message when document is undefined', () => {
    expect(typeof document).toBe('undefined');

    const result = readDomById('any-id');

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('dom://byId/any-id');
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toBe('DOM not available (not in a browser environment)');
  });

  it('readDomBySelector returns SSR message when document is undefined', () => {
    expect(typeof document).toBe('undefined');

    const result = readDomBySelector('div');

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('dom://selector/div');
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toBe('DOM not available (not in a browser environment)');
  });
});
