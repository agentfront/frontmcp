import { validationErrorBox } from './error-box';

describe('validationErrorBox', () => {
  describe('basic rendering', () => {
    it('should render component name', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('Button: Invalid Configuration');
    });

    it('should render invalid param name', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('The "variant" parameter is invalid.');
    });

    it('should handle nested param paths', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'htmx.get',
      });
      expect(html).toContain('The "htmx.get" parameter is invalid.');
    });

    it('should handle deeply nested param paths', () => {
      const html = validationErrorBox({
        componentName: 'Form',
        invalidParam: 'fields.0.validation.pattern',
      });
      expect(html).toContain('The "fields.0.validation.pattern" parameter is invalid.');
    });
  });

  describe('data attributes', () => {
    it('should include data-testid for testing', () => {
      const html = validationErrorBox({
        componentName: 'Card',
        invalidParam: 'size',
      });
      expect(html).toContain('data-testid="validation-error"');
    });

    it('should include data-component attribute', () => {
      const html = validationErrorBox({
        componentName: 'Card',
        invalidParam: 'size',
      });
      expect(html).toContain('data-component="Card"');
    });

    it('should include data-param attribute', () => {
      const html = validationErrorBox({
        componentName: 'Card',
        invalidParam: 'size',
      });
      expect(html).toContain('data-param="size"');
    });
  });

  describe('XSS prevention', () => {
    it('should escape HTML in component name', () => {
      const html = validationErrorBox({
        componentName: '<script>alert("xss")</script>',
        invalidParam: 'test',
      });
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert("xss")</script>');
    });

    it('should escape HTML in param name', () => {
      const html = validationErrorBox({
        componentName: 'Test',
        invalidParam: '"><script>alert("xss")</script>',
      });
      expect(html).toContain('&gt;&lt;script&gt;');
      expect(html).not.toContain('<script>alert("xss")</script>');
    });

    it('should escape quotes in component name', () => {
      const html = validationErrorBox({
        componentName: 'Component"Name',
        invalidParam: 'test',
      });
      expect(html).toContain('&quot;');
    });

    it('should escape quotes in param name', () => {
      const html = validationErrorBox({
        componentName: 'Test',
        invalidParam: 'param"name',
      });
      expect(html).toContain('&quot;');
    });
  });

  describe('styling', () => {
    it('should include error styling classes', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('bg-red-50');
      expect(html).toContain('border-red-200');
      expect(html).toContain('text-red-800');
    });

    it('should include alert role for accessibility', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('role="alert"');
    });

    it('should include validation-error class', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('class="validation-error');
    });

    it('should include error icon SVG', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('<svg');
      expect(html).toContain('</svg>');
    });
  });

  describe('different components', () => {
    it('should work with Button component', () => {
      const html = validationErrorBox({
        componentName: 'Button',
        invalidParam: 'variant',
      });
      expect(html).toContain('Button: Invalid Configuration');
    });

    it('should work with Card component', () => {
      const html = validationErrorBox({
        componentName: 'Card',
        invalidParam: 'padding',
      });
      expect(html).toContain('Card: Invalid Configuration');
    });

    it('should work with Form component', () => {
      const html = validationErrorBox({
        componentName: 'Form',
        invalidParam: 'action',
      });
      expect(html).toContain('Form: Invalid Configuration');
    });

    it('should work with Modal component', () => {
      const html = validationErrorBox({
        componentName: 'Modal',
        invalidParam: 'size',
      });
      expect(html).toContain('Modal: Invalid Configuration');
    });
  });
});
