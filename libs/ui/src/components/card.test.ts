import { card, cardGroup } from './card';

describe('Card Component', () => {
  describe('card', () => {
    it('should render card content', () => {
      const html = card('<p>Card content</p>');
      expect(html).toContain('<p>Card content</p>');
    });

    it('should apply default variant', () => {
      const html = card('Content');
      expect(html).toContain('bg-white');
      expect(html).toContain('border');
      expect(html).toContain('rounded-xl');
    });

    it('should apply outlined variant', () => {
      const html = card('Content', { variant: 'outlined' });
      expect(html).toContain('border-2');
      expect(html).toContain('bg-transparent');
    });

    it('should apply elevated variant', () => {
      const html = card('Content', { variant: 'elevated' });
      expect(html).toContain('shadow-lg');
    });

    it('should apply filled variant', () => {
      const html = card('Content', { variant: 'filled' });
      expect(html).toContain('bg-gray-50');
    });

    it('should apply ghost variant', () => {
      const html = card('Content', { variant: 'ghost' });
      expect(html).toContain('bg-transparent');
    });

    it('should apply size classes', () => {
      const sizes = [
        { size: 'sm' as const, class: 'p-4' },
        { size: 'md' as const, class: 'p-6' },
        { size: 'lg' as const, class: 'p-8' },
      ];

      for (const { size, class: expected } of sizes) {
        const html = card('Content', { size });
        expect(html).toContain(expected);
      }
    });

    it('should render title when provided', () => {
      const html = card('Content', { title: 'Card Title' });
      expect(html).toContain('Card Title');
      expect(html).toContain('<h3');
    });

    it('should render subtitle when provided', () => {
      const html = card('Content', {
        title: 'Title',
        subtitle: 'Card subtitle',
      });
      expect(html).toContain('Card subtitle');
    });

    it('should render header actions', () => {
      const html = card('Content', {
        title: 'Title',
        headerActions: '<button>Edit</button>',
      });
      expect(html).toContain('<button>Edit</button>');
    });

    it('should render footer', () => {
      const html = card('Content', {
        footer: '<button>Save</button>',
      });
      expect(html).toContain('<button>Save</button>');
      expect(html).toContain('border-t');
    });

    it('should set card id', () => {
      const html = card('Content', { id: 'my-card' });
      expect(html).toContain('id="my-card"');
    });

    it('should apply clickable styling', () => {
      const html = card('Content', { clickable: true });
      expect(html).toContain('cursor-pointer');
      expect(html).toContain('hover:shadow-md');
    });

    it('should render as anchor when href provided', () => {
      const html = card('Content', { href: '/path' });
      expect(html).toContain('<a');
      expect(html).toContain('href="/path"');
    });

    it('should include data attributes', () => {
      const html = card('Content', {
        data: {
          cardId: '123',
        },
      });
      expect(html).toContain('data-cardId="123"');
    });

    it('should add custom classes', () => {
      const html = card('Content', { className: 'my-custom-class' });
      expect(html).toContain('my-custom-class');
    });

    it('should escape title to prevent XSS', () => {
      const html = card('Content', {
        title: '<script>alert("xss")</script>',
      });
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('cardGroup', () => {
    const cards = [card('Card 1'), card('Card 2'), card('Card 3')];

    it('should wrap cards in container', () => {
      const html = cardGroup(cards);
      expect(html).toContain('Card 1');
      expect(html).toContain('Card 2');
      expect(html).toContain('Card 3');
    });

    it('should apply vertical direction by default', () => {
      const html = cardGroup(cards);
      expect(html).toContain('flex-col');
    });

    it('should apply horizontal direction', () => {
      const html = cardGroup(cards, { direction: 'horizontal' });
      expect(html).toContain('flex-row');
    });

    it('should apply gap classes', () => {
      const gaps = ['sm', 'md', 'lg'] as const;
      for (const gap of gaps) {
        const html = cardGroup(cards, { gap });
        expect(html).toContain('gap-');
      }
    });

    it('should add custom classes', () => {
      const html = cardGroup(cards, { className: 'custom-group' });
      expect(html).toContain('custom-group');
    });
  });
});
