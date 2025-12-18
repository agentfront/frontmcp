import {
  button,
  buttonGroup,
  primaryButton,
  secondaryButton,
  outlineButton,
  ghostButton,
  dangerButton,
  linkButton,
} from './button';

describe('Button Component', () => {
  describe('button', () => {
    it('should render a basic button', () => {
      const html = button('Click Me');
      expect(html).toContain('<button');
      expect(html).toContain('Click Me');
      expect(html).toContain('</button>');
    });

    it('should set button type', () => {
      const html = button('Submit', { type: 'submit' });
      expect(html).toContain('type="submit"');
    });

    it('should apply primary variant by default', () => {
      const html = button('Test');
      expect(html).toContain('bg-primary');
      expect(html).toContain('text-white');
    });

    it('should apply secondary variant', () => {
      const html = button('Test', { variant: 'secondary' });
      expect(html).toContain('bg-secondary');
    });

    it('should apply outline variant', () => {
      const html = button('Test', { variant: 'outline' });
      expect(html).toContain('border-2');
      expect(html).toContain('border-primary');
    });

    it('should apply ghost variant', () => {
      const html = button('Test', { variant: 'ghost' });
      expect(html).toContain('hover:bg-gray-100');
    });

    it('should apply danger variant', () => {
      const html = button('Test', { variant: 'danger' });
      expect(html).toContain('bg-danger');
    });

    it('should apply link variant', () => {
      const html = button('Test', { variant: 'link' });
      expect(html).toContain('hover:underline');
    });

    it('should apply size classes', () => {
      const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
      for (const size of sizes) {
        const html = button('Test', { size });
        expect(html).toContain('px-'); // Has padding
      }
    });

    it('should handle disabled state', () => {
      const html = button('Test', { disabled: true });
      expect(html).toContain('disabled');
      expect(html).toContain('opacity-50');
      expect(html).toContain('cursor-not-allowed');
    });

    it('should handle loading state', () => {
      const html = button('Test', { loading: true });
      expect(html).toContain('animate-spin');
      expect(html).toContain('disabled');
    });

    it('should apply full width', () => {
      const html = button('Test', { fullWidth: true });
      expect(html).toContain('w-full');
    });

    it('should include icon before text', () => {
      const html = button('Test', { iconBefore: '<svg>icon</svg>' });
      expect(html).toContain('<svg>icon</svg>');
    });

    it('should include icon after text', () => {
      const html = button('Test', { iconAfter: '<svg>icon</svg>' });
      expect(html).toContain('<svg>icon</svg>');
    });

    it('should set button id', () => {
      const html = button('Test', { id: 'my-button' });
      expect(html).toContain('id="my-button"');
    });

    it('should set button name and value', () => {
      const html = button('Test', { name: 'action', value: 'submit' });
      expect(html).toContain('name="action"');
      expect(html).toContain('value="submit"');
    });

    it('should render as anchor when href provided', () => {
      const html = button('Link', { href: '/path' });
      expect(html).toContain('<a');
      expect(html).toContain('href="/path"');
      expect(html).not.toContain('<button');
    });

    it('should set target on anchor', () => {
      const html = button('Link', { href: '/path', target: '_blank' });
      expect(html).toContain('target="_blank"');
    });

    it('should include data attributes', () => {
      const html = button('Test', {
        data: {
          action: 'submit',
          id: '123',
        },
      });
      expect(html).toContain('data-action="submit"');
      expect(html).toContain('data-id="123"');
    });

    it('should include aria-label', () => {
      const html = button('X', { ariaLabel: 'Close' });
      expect(html).toContain('aria-label="Close"');
    });

    it('should escape text to prevent XSS', () => {
      const html = button('<script>alert("xss")</script>');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('buttonGroup', () => {
    const buttons = [button('One'), button('Two'), button('Three')];

    it('should wrap buttons in a container', () => {
      const html = buttonGroup(buttons);
      expect(html).toContain('<div');
      expect(html).toContain('</div>');
      expect(html).toContain('One');
      expect(html).toContain('Two');
      expect(html).toContain('Three');
    });

    it('should apply attached styling', () => {
      const html = buttonGroup(buttons, { attached: true });
      expect(html).toContain('rounded-r-none');
      expect(html).toContain('rounded-l-none');
    });

    it('should apply horizontal direction', () => {
      const html = buttonGroup(buttons, { direction: 'horizontal' });
      expect(html).toContain('flex-row');
    });

    it('should apply vertical direction', () => {
      const html = buttonGroup(buttons, { direction: 'vertical' });
      expect(html).toContain('flex-col');
    });

    it('should apply gap classes', () => {
      const gaps = ['sm', 'md', 'lg'] as const;
      for (const gap of gaps) {
        const html = buttonGroup(buttons, { gap });
        expect(html).toContain('gap-');
      }
    });
  });

  describe('Shorthand functions', () => {
    it('primaryButton should create primary variant', () => {
      const html = primaryButton('Test');
      expect(html).toContain('bg-primary');
    });

    it('secondaryButton should create secondary variant', () => {
      const html = secondaryButton('Test');
      expect(html).toContain('bg-secondary');
    });

    it('outlineButton should create outline variant', () => {
      const html = outlineButton('Test');
      expect(html).toContain('border-primary');
    });

    it('ghostButton should create ghost variant', () => {
      const html = ghostButton('Test');
      expect(html).toContain('hover:bg-gray-100');
    });

    it('dangerButton should create danger variant', () => {
      const html = dangerButton('Test');
      expect(html).toContain('bg-danger');
    });

    it('linkButton should create link variant', () => {
      const html = linkButton('Test');
      expect(html).toContain('hover:underline');
    });
  });

  describe('Validation', () => {
    it('should return error box for invalid variant', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = button('Test', { variant: 'invalid' as any });
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="button"');
      expect(html).toContain('data-param="variant"');
    });

    it('should return error box for invalid size', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = button('Test', { size: 'huge' as any });
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="button"');
      expect(html).toContain('data-param="size"');
    });

    it('should return error box for invalid type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = button('Test', { type: 'custom' as any });
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="button"');
      expect(html).toContain('data-param="type"');
    });

    it('should return error box for unknown properties (strict mode)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = button('Test', { unknownProp: 'value' } as any);
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="button"');
    });

    it('should return error box for invalid htmx configuration', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = button('Test', { htmx: { invalidKey: 'value' } as any });
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="button"');
    });

    it('should accept valid options without error', () => {
      const html = button('Test', {
        variant: 'primary',
        size: 'md',
        type: 'submit',
        disabled: false,
        loading: false,
        fullWidth: true,
        className: 'custom-class',
      });
      expect(html).not.toContain('validation-error');
      expect(html).toContain('<button');
    });
  });

  describe('buttonGroup Validation', () => {
    const buttons = [button('One'), button('Two')];

    it('should return error box for invalid direction', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = buttonGroup(buttons, { direction: 'diagonal' as any });
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="buttonGroup"');
      expect(html).toContain('data-param="direction"');
    });

    it('should return error box for invalid gap', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = buttonGroup(buttons, { gap: 'xl' as any });
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="buttonGroup"');
      expect(html).toContain('data-param="gap"');
    });

    it('should return error box for unknown properties (strict mode)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = buttonGroup(buttons, { unknownProp: true } as any);
      expect(html).toContain('validation-error');
      expect(html).toContain('data-component="buttonGroup"');
    });

    it('should accept valid options without error', () => {
      const html = buttonGroup(buttons, {
        attached: true,
        direction: 'horizontal',
        gap: 'md',
        className: 'custom-class',
      });
      expect(html).not.toContain('validation-error');
      expect(html).toContain('<div');
    });
  });
});
