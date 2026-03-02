/**
 * Built-in DOM resource templates.
 *
 * Provides `dom://byId/{id}` and `dom://selector/{selector}` that read
 * DOM elements and return their outerHTML + text content.
 */

export interface DomResourceResult {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}

/**
 * Read a DOM element by its ID.
 *
 * @param id - The element ID to look up
 * @returns MCP ReadResourceResult shape
 */
export function readDomById(id: string): DomResourceResult {
  if (typeof document === 'undefined') {
    return {
      contents: [
        {
          uri: `dom://byId/${id}`,
          mimeType: 'text/plain',
          text: 'DOM not available (not in a browser environment)',
        },
      ],
    };
  }

  const el = document.getElementById(id);
  if (!el) {
    return {
      contents: [
        {
          uri: `dom://byId/${id}`,
          mimeType: 'text/plain',
          text: `Element with id "${id}" not found`,
        },
      ],
    };
  }

  return {
    contents: [
      {
        uri: `dom://byId/${id}`,
        mimeType: 'application/json',
        text: JSON.stringify({
          outerHTML: el.outerHTML,
          textContent: el.textContent ?? '',
          tagName: el.tagName.toLowerCase(),
        }),
      },
    ],
  };
}

/**
 * Read DOM elements by CSS selector.
 *
 * @param selector - CSS selector string
 * @returns MCP ReadResourceResult shape
 */
export function readDomBySelector(selector: string): DomResourceResult {
  if (typeof document === 'undefined') {
    return {
      contents: [
        {
          uri: `dom://selector/${selector}`,
          mimeType: 'text/plain',
          text: 'DOM not available (not in a browser environment)',
        },
      ],
    };
  }

  const elements = document.querySelectorAll(selector);
  if (elements.length === 0) {
    return {
      contents: [
        {
          uri: `dom://selector/${selector}`,
          mimeType: 'text/plain',
          text: `No elements found matching "${selector}"`,
        },
      ],
    };
  }

  const items = Array.from(elements).map((el) => ({
    outerHTML: el.outerHTML,
    textContent: el.textContent ?? '',
    tagName: el.tagName.toLowerCase(),
  }));

  return {
    contents: [
      {
        uri: `dom://selector/${selector}`,
        mimeType: 'application/json',
        text: JSON.stringify(items),
      },
    ],
  };
}
