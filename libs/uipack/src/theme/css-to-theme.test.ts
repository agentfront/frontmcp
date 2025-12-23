import { cssToTailwindTheme, buildTailwindStyleBlock } from './css-to-theme';

describe('css-to-theme', () => {
  describe('cssToTailwindTheme', () => {
    it('should extract color variables from :root', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
  --color-secondary: #6b7280;
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.colorVars.get('color-primary')).toBe('#0556b2');
      expect(result.colorVars.get('color-secondary')).toBe('#6b7280');
      expect(result.colorVars.size).toBe(2);
    });

    it('should generate @theme block with color variables', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
  --color-success: #10b981;
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.themeBlock).toContain('@theme');
      expect(result.themeBlock).toContain('--color-primary: #0556b2;');
      expect(result.themeBlock).toContain('--color-success: #10b981;');
    });

    it('should remove color variables from remaining CSS', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
  --font-family: Inter;
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.remainingCss).not.toContain('--color-primary');
      expect(result.remainingCss).toContain('--font-family: Inter');
    });

    it('should handle CSS with multiple --color-* variations', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
  --color-primary-hover: #03a223;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-border: #e5e7eb;
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.colorVars.size).toBe(5);
      expect(result.colorVars.get('color-primary')).toBe('#0556b2');
      expect(result.colorVars.get('color-primary-hover')).toBe('#03a223');
      expect(result.colorVars.get('color-text')).toBe('#111827');
      expect(result.colorVars.get('color-text-secondary')).toBe('#6b7280');
      expect(result.colorVars.get('color-border')).toBe('#e5e7eb');
    });

    it('should handle CSS with no color variables', () => {
      const userCss = `:root {
  --font-family: Inter;
  --border-radius: 8px;
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.colorVars.size).toBe(0);
      expect(result.themeBlock).toBe('');
      expect(result.remainingCss).toContain('--font-family: Inter');
      expect(result.remainingCss).toContain('--border-radius: 8px');
    });

    it('should handle empty CSS', () => {
      const result = cssToTailwindTheme('');

      expect(result.colorVars.size).toBe(0);
      expect(result.themeBlock).toBe('');
      expect(result.remainingCss).toBe('');
    });

    it('should handle color values with rgb/rgba syntax', () => {
      const userCss = `:root {
  --color-overlay: rgba(27, 31, 36, 0.5);
  --color-primary: rgb(5, 86, 178);
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.colorVars.get('color-overlay')).toBe('rgba(27, 31, 36, 0.5)');
      expect(result.colorVars.get('color-primary')).toBe('rgb(5, 86, 178)');
    });

    it('should handle color values with hsl syntax', () => {
      const userCss = `:root {
  --color-primary: hsl(210, 100%, 50%);
  --color-secondary: hsla(0, 0%, 50%, 0.8);
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.colorVars.get('color-primary')).toBe('hsl(210, 100%, 50%)');
      expect(result.colorVars.get('color-secondary')).toBe('hsla(0, 0%, 50%, 0.8)');
    });

    it('should preserve non-root CSS blocks', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
}

body {
  font-family: var(--font-family);
}

.card {
  background: var(--color-surface);
}`;

      const result = cssToTailwindTheme(userCss);

      expect(result.remainingCss).toContain('body {');
      expect(result.remainingCss).toContain('.card {');
      expect(result.remainingCss).toContain('font-family: var(--font-family)');
    });
  });

  describe('buildTailwindStyleBlock', () => {
    it('should generate complete style tag with @theme', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
}`;

      const result = buildTailwindStyleBlock(userCss);

      expect(result).toContain('<style type="text/tailwindcss">');
      expect(result).toContain('</style>');
      expect(result).toContain('@theme');
      expect(result).toContain('--color-primary: #0556b2;');
    });

    it('should include remaining CSS in style block', () => {
      const userCss = `:root {
  --color-primary: #0556b2;
  --font-family: Inter;
}`;

      const result = buildTailwindStyleBlock(userCss);

      expect(result).toContain('@theme');
      expect(result).toContain('--color-primary: #0556b2;');
      expect(result).toContain('--font-family: Inter');
    });

    it('should return empty string for empty input', () => {
      const result = buildTailwindStyleBlock('');
      expect(result).toBe('');
    });

    it('should handle CSS with only non-color variables', () => {
      const userCss = `:root {
  --font-family: Inter;
}`;

      const result = buildTailwindStyleBlock(userCss);

      expect(result).toContain('<style type="text/tailwindcss">');
      expect(result).not.toContain('@theme');
      expect(result).toContain('--font-family: Inter');
    });
  });
});
