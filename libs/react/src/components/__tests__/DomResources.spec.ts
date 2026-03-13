import { readDomById, readDomBySelector } from '../DomResources';

describe('DomResources', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('readDomById', () => {
    it('finds element and returns outerHTML, textContent, and tagName', () => {
      const div = document.createElement('div');
      div.id = 'test-el';
      div.textContent = 'Hello DOM';
      document.body.appendChild(div);

      const result = readDomById('test-el');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('dom://byId/test-el');
      expect(result.contents[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.outerHTML).toBe('<div id="test-el">Hello DOM</div>');
      expect(parsed.textContent).toBe('Hello DOM');
      expect(parsed.tagName).toBe('div');
    });

    it('returns not-found message when element does not exist', () => {
      const result = readDomById('nonexistent');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('dom://byId/nonexistent');
      expect(result.contents[0].mimeType).toBe('text/plain');
      expect(result.contents[0].text).toBe('Element with id "nonexistent" not found');
    });

    it('handles element with empty textContent', () => {
      const span = document.createElement('span');
      span.id = 'empty-text';
      document.body.appendChild(span);

      const result = readDomById('empty-text');
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.textContent).toBe('');
      expect(parsed.tagName).toBe('span');
    });
  });

  describe('readDomBySelector', () => {
    it('finds elements matching selector', () => {
      const container = document.createElement('div');
      container.innerHTML = '<p class="item">First</p><p class="item">Second</p>';
      document.body.appendChild(container);

      const result = readDomBySelector('.item');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('dom://selector/.item');
      expect(result.contents[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].textContent).toBe('First');
      expect(parsed[0].tagName).toBe('p');
      expect(parsed[0].outerHTML).toBe('<p class="item">First</p>');
      expect(parsed[1].textContent).toBe('Second');
    });

    it('returns no-matches message when no elements found', () => {
      const result = readDomBySelector('.does-not-exist');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('dom://selector/.does-not-exist');
      expect(result.contents[0].mimeType).toBe('text/plain');
      expect(result.contents[0].text).toBe('No elements found matching ".does-not-exist"');
    });

    it('finds elements by attribute selector', () => {
      const container = document.createElement('div');
      container.id = 'selector-test-container';
      container.innerHTML = '<span data-marker="sel-test">A</span><span data-marker="sel-test">B</span>';
      document.body.appendChild(container);

      const result = readDomBySelector('#selector-test-container span[data-marker="sel-test"]');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].tagName).toBe('span');
      expect(parsed[1].tagName).toBe('span');
    });

    it('returns error for invalid CSS selector', () => {
      const result = readDomBySelector('[invalid');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('dom://selector/[invalid');
      expect(result.contents[0].mimeType).toBe('text/plain');
      expect(result.contents[0].text).toBe('Invalid selector: "[invalid"');
    });

    it('handles elements with null textContent', () => {
      const container = document.createElement('div');
      const el = document.createElement('br');
      el.className = 'br-test';
      container.appendChild(el);
      document.body.appendChild(container);

      const result = readDomBySelector('.br-test');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].textContent).toBe('');
      expect(parsed[0].tagName).toBe('br');
    });

    it('handles element with overridden null textContent via selector', () => {
      const container = document.createElement('div');
      const el = document.createElement('span');
      el.className = 'null-text-sel';
      Object.defineProperty(el, 'textContent', { get: () => null, configurable: true });
      container.appendChild(el);
      document.body.appendChild(container);

      const result = readDomBySelector('.null-text-sel');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].textContent).toBe('');
    });
  });

  describe('readDomById — null textContent branch', () => {
    it('handles element with overridden null textContent', () => {
      const el = document.createElement('div');
      el.id = 'null-text-id';
      Object.defineProperty(el, 'textContent', { get: () => null, configurable: true });
      document.body.appendChild(el);

      const result = readDomById('null-text-id');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.textContent).toBe('');
      expect(parsed.tagName).toBe('div');
    });
  });
});
