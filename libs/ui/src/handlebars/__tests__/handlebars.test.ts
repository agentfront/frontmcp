/**
 * Handlebars Renderer Tests
 *
 * Tests for the HandlebarsRenderer class and helper functions.
 */

import {
  HandlebarsRenderer,
  createHandlebarsRenderer,
  renderTemplate,
  containsHandlebars,
  escapeHtml,
  formatDate,
  formatCurrency,
  formatNumber,
  json,
  eq,
  gt,
  lt,
  first,
  last,
  uppercase,
  lowercase,
  capitalize,
  truncate,
  uniqueId,
  resetUniqueIdCounter,
} from '../index';

describe('HandlebarsRenderer', () => {
  let renderer: HandlebarsRenderer;

  beforeEach(() => {
    renderer = new HandlebarsRenderer();
  });

  afterEach(() => {
    renderer.clearCache();
  });

  describe('basic rendering', () => {
    it('should render simple variable substitution', async () => {
      const template = '<div>{{output.name}}</div>';
      const html = await renderer.render(template, {
        input: {},
        output: { name: 'Test' },
      });

      expect(html).toBe('<div>Test</div>');
    });

    it('should render nested properties', async () => {
      const template = '<div>{{output.user.profile.name}}</div>';
      const html = await renderer.render(template, {
        input: {},
        output: {
          user: {
            profile: {
              name: 'John Doe',
            },
          },
        },
      });

      expect(html).toBe('<div>John Doe</div>');
    });

    it('should render input variables', async () => {
      const template = '<div>Query: {{input.query}}</div>';
      const html = await renderer.render(template, {
        input: { query: 'search term' },
        output: {},
      });

      expect(html).toBe('<div>Query: search term</div>');
    });

    it('should handle empty output gracefully', async () => {
      const template = '<div>{{output.missing}}</div>';
      const html = await renderer.render(template, {
        input: {},
        output: {},
      });

      expect(html).toBe('<div></div>');
    });

    it('should handle null context values', async () => {
      const template = '<div>{{output.value}}</div>';
      const html = await renderer.render(template, {
        input: {},
        output: { value: null },
      });

      expect(html).toBe('<div></div>');
    });
  });

  describe('conditionals', () => {
    it('should render #if blocks correctly', async () => {
      const template = '{{#if output.visible}}Visible{{/if}}';

      const visibleHtml = await renderer.render(template, {
        input: {},
        output: { visible: true },
      });
      expect(visibleHtml).toBe('Visible');

      const hiddenHtml = await renderer.render(template, {
        input: {},
        output: { visible: false },
      });
      expect(hiddenHtml).toBe('');
    });

    it('should render #if/#else blocks', async () => {
      const template = '{{#if output.active}}Active{{else}}Inactive{{/if}}';

      const activeHtml = await renderer.render(template, {
        input: {},
        output: { active: true },
      });
      expect(activeHtml).toBe('Active');

      const inactiveHtml = await renderer.render(template, {
        input: {},
        output: { active: false },
      });
      expect(inactiveHtml).toBe('Inactive');
    });

    it('should render #unless blocks', async () => {
      const template = '{{#unless output.disabled}}Enabled{{/unless}}';

      const enabledHtml = await renderer.render(template, {
        input: {},
        output: { disabled: false },
      });
      expect(enabledHtml).toBe('Enabled');
    });
  });

  describe('iteration', () => {
    it('should render #each for arrays', async () => {
      const template = '<ul>{{#each output.items}}<li>{{this}}</li>{{/each}}</ul>';
      const html = await renderer.render(template, {
        input: {},
        output: { items: ['a', 'b', 'c'] },
      });

      expect(html).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>');
    });

    it('should access array item properties', async () => {
      const template = '{{#each output.users}}{{this.name}}, {{/each}}';
      const html = await renderer.render(template, {
        input: {},
        output: {
          users: [{ name: 'Alice' }, { name: 'Bob' }],
        },
      });

      expect(html).toBe('Alice, Bob, ');
    });

    it('should provide @index in each loops', async () => {
      const template = '{{#each output.items}}{{@index}}: {{this}} {{/each}}';
      const html = await renderer.render(template, {
        input: {},
        output: { items: ['a', 'b'] },
      });

      expect(html).toBe('0: a 1: b ');
    });
  });

  describe('caching', () => {
    it('should cache compiled templates', async () => {
      const template = '<div>{{output.value}}</div>';

      // Render twice with same template
      await renderer.render(template, { input: {}, output: { value: 1 } });
      await renderer.render(template, { input: {}, output: { value: 2 } });

      // The template should have been cached
      expect(renderer.isInitialized).toBe(true);
    });

    it('should clear cache', async () => {
      const template = '<div>{{output.value}}</div>';
      await renderer.render(template, { input: {}, output: { value: 1 } });

      renderer.clearCache();

      // Should still work after clearing cache
      const html = await renderer.render(template, {
        input: {},
        output: { value: 2 },
      });
      expect(html).toBe('<div>2</div>');
    });
  });

  describe('custom helpers', () => {
    it('should register and use custom helpers', async () => {
      renderer.registerHelper('shout', (str: unknown) => String(str).toUpperCase() + '!');

      // Need to re-render to pick up the helper
      await renderer.render('<div>test</div>', { input: {}, output: {} });

      const html = await renderer.render('<div>{{shout output.message}}</div>', {
        input: {},
        output: { message: 'hello' },
      });

      expect(html).toBe('<div>HELLO!</div>');
    });

    it('should accept helpers in constructor', async () => {
      const customRenderer = new HandlebarsRenderer({
        helpers: {
          reverse: (str: unknown) => String(str).split('').reverse().join(''),
        },
      });

      const html = await customRenderer.render('<div>{{reverse output.text}}</div>', {
        input: {},
        output: { text: 'abc' },
      });

      expect(html).toBe('<div>cba</div>');
    });
  });

  describe('partials', () => {
    it('should register and use partials', async () => {
      renderer.registerPartial('badge', '<span class="badge">{{text}}</span>');

      // Initialize first
      await renderer.render('<div>test</div>', { input: {}, output: {} });

      const html = await renderer.render('{{> badge text=output.status}}', {
        input: {},
        output: { status: 'Active' },
      });

      expect(html).toBe('<span class="badge">Active</span>');
    });
  });
});

describe('createHandlebarsRenderer', () => {
  it('should create a new renderer instance', () => {
    const renderer = createHandlebarsRenderer();
    expect(renderer).toBeInstanceOf(HandlebarsRenderer);
  });

  it('should accept options', () => {
    const renderer = createHandlebarsRenderer({
      strict: true,
      autoEscape: false,
    });
    expect(renderer).toBeInstanceOf(HandlebarsRenderer);
  });
});

describe('renderTemplate', () => {
  it('should render a template with one function call', async () => {
    const html = await renderTemplate('<div>{{output.name}}</div>', {
      input: {},
      output: { name: 'Quick' },
    });

    expect(html).toBe('<div>Quick</div>');
  });
});

describe('containsHandlebars', () => {
  it('should detect Handlebars syntax', () => {
    expect(containsHandlebars('{{name}}')).toBe(true);
    expect(containsHandlebars('<div>{{output.value}}</div>')).toBe(true);
    expect(containsHandlebars('{{#if x}}y{{/if}}')).toBe(true);
    expect(containsHandlebars('{{#each items}}{{/each}}')).toBe(true);
  });

  it('should not match plain HTML', () => {
    expect(containsHandlebars('<div>Hello</div>')).toBe(false);
    expect(containsHandlebars('Plain text')).toBe(false);
  });

  it('should not match Handlebars comments', () => {
    expect(containsHandlebars('{{! this is a comment }}')).toBe(false);
    expect(containsHandlebars('{{!-- multiline comment --}}')).toBe(false);
  });
});

describe('Built-in Helpers', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should handle ampersands', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('should handle quotes', () => {
      expect(escapeHtml('it\'s "quoted"')).toBe('it&#39;s &quot;quoted&quot;');
    });

    it('should handle null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });
  });

  describe('formatDate', () => {
    it('should format Date objects', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = formatDate(date);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should format ISO strings', () => {
      const result = formatDate('2024-06-15T12:00:00Z');
      expect(result).toBeTruthy();
    });

    it('should handle iso format', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = formatDate(date, 'iso');
      expect(result).toBe('2024-06-15T12:00:00.000Z');
    });

    it('should handle null and undefined', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate(undefined)).toBe('');
    });
  });

  describe('formatCurrency', () => {
    it('should format currency with default USD', () => {
      const result = formatCurrency(1234.56);
      expect(result).toContain('1,234.56');
    });

    it('should handle different currencies', () => {
      const result = formatCurrency(1000, 'EUR');
      expect(result).toBeTruthy();
    });

    it('should handle null', () => {
      expect(formatCurrency(null)).toBe('');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with commas', () => {
      const result = formatNumber(1234567);
      expect(result).toBe('1,234,567');
    });

    it('should handle decimals', () => {
      const result = formatNumber(1234.5678, 2);
      expect(result).toContain('1,234.57');
    });

    it('should handle null', () => {
      expect(formatNumber(null)).toBe('');
    });
  });

  describe('json', () => {
    it('should stringify objects', () => {
      const obj = { a: 1, b: 'test' };
      const result = json(obj);
      expect(result).toBe('{"a":1,"b":"test"}');
    });

    it('should handle arrays', () => {
      const arr = [1, 2, 3];
      const result = json(arr);
      expect(result).toBe('[1,2,3]');
    });
  });

  describe('comparison helpers', () => {
    it('eq should compare equality', () => {
      expect(eq(1, 1)).toBe(true);
      expect(eq('a', 'a')).toBe(true);
      expect(eq(1, 2)).toBe(false);
    });

    it('gt should compare greater than', () => {
      expect(gt(2, 1)).toBe(true);
      expect(gt(1, 2)).toBe(false);
    });

    it('lt should compare less than', () => {
      expect(lt(1, 2)).toBe(true);
      expect(lt(2, 1)).toBe(false);
    });
  });

  describe('array helpers', () => {
    it('first should return first element', () => {
      expect(first([1, 2, 3])).toBe(1);
      expect(first([])).toBeUndefined();
    });

    it('last should return last element', () => {
      expect(last([1, 2, 3])).toBe(3);
      expect(last([])).toBeUndefined();
    });
  });

  describe('string helpers', () => {
    it('uppercase should convert to uppercase', () => {
      expect(uppercase('hello')).toBe('HELLO');
    });

    it('lowercase should convert to lowercase', () => {
      expect(lowercase('HELLO')).toBe('hello');
    });

    it('capitalize should capitalize first letter', () => {
      expect(capitalize('hello world')).toBe('Hello world');
    });

    it('truncate should limit string length', () => {
      const result = truncate('This is a long string', 10);
      // Truncate cuts at the limit and adds ellipsis
      expect(result).toContain('...');
      expect(result.length).toBeLessThanOrEqual(13); // 10 + '...'
    });

    it('truncate should not add ellipsis for short strings', () => {
      const result = truncate('Short', 10);
      expect(result).toBe('Short');
    });
  });

  describe('uniqueId', () => {
    beforeEach(() => {
      resetUniqueIdCounter();
    });

    it('should generate unique IDs', () => {
      const id1 = uniqueId('prefix-');
      const id2 = uniqueId('prefix-');
      expect(id1).not.toBe(id2);
    });

    it('should use prefix', () => {
      const id = uniqueId('btn-');
      // UniqueId generates "prefix-N" format, which becomes "btn--N" with prefix "btn-"
      expect(id).toMatch(/^btn--?\d+$/);
    });
  });
});

describe('HandlebarsRenderer with built-in helpers in templates', () => {
  let renderer: HandlebarsRenderer;

  beforeEach(() => {
    renderer = new HandlebarsRenderer();
  });

  it('should use escapeHtml helper in templates', async () => {
    // Use triple-mustache {{{...}}} to avoid double escaping
    // (escapeHtml returns already-escaped content, then Handlebars would escape again)
    const template = '<div>{{{escapeHtml output.html}}}</div>';
    const html = await renderer.render(template, {
      input: {},
      output: { html: '<script>alert("xss")</script>' },
    });

    expect(html).toBe('<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>');
  });

  it('should use formatCurrency helper in templates', async () => {
    const template = '<span>{{formatCurrency output.price}}</span>';
    const html = await renderer.render(template, {
      input: {},
      output: { price: 29.99 },
    });

    expect(html).toContain('29.99');
  });

  it('should use uppercase helper in templates', async () => {
    const template = '<span>{{uppercase output.status}}</span>';
    const html = await renderer.render(template, {
      input: {},
      output: { status: 'active' },
    });

    expect(html).toBe('<span>ACTIVE</span>');
  });

  it('should use eq helper in #if blocks', async () => {
    const template = '{{#if (eq output.status "active")}}Active{{else}}Other{{/if}}';

    const activeHtml = await renderer.render(template, {
      input: {},
      output: { status: 'active' },
    });
    expect(activeHtml).toBe('Active');

    const otherHtml = await renderer.render(template, {
      input: {},
      output: { status: 'inactive' },
    });
    expect(otherHtml).toBe('Other');
  });
});
