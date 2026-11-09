import { buildHtmlResponseText } from '../response-builder';

describe('buildHtmlResponseText', () => {
  it('puts the prefix, a colon and the page in an html code fence', () => {
    expect(buildHtmlResponseText('Here is the weather dashboard', '<!DOCTYPE html><p>21°C</p>')).toBe(
      'Here is the weather dashboard:\n\n```html\n<!DOCTYPE html><p>21°C</p>\n```',
    );
  });

  it('uses a fence longer than any run of backticks in the page, so the page cannot close it', () => {
    const text = buildHtmlResponseText('Report', '<pre>```js\nx\n```</pre><code>````</code>');
    expect(text.startsWith('Report:\n\n`````html\n')).toBe(true);
    expect(text.endsWith('\n`````')).toBe(true);
  });
});
