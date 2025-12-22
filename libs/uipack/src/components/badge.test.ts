import {
  badge,
  badgeGroup,
  activeBadge,
  inactiveBadge,
  pendingBadge,
  errorBadge,
  newBadge,
  betaBadge,
  onlineDot,
  offlineDot,
  busyDot,
  awayDot,
} from './badge';

describe('Badge Component', () => {
  describe('badge', () => {
    it('should render basic badge', () => {
      const html = badge('Test');
      expect(html).toContain('Test');
      expect(html).toContain('<span');
    });

    it('should apply default variant', () => {
      const html = badge('Test');
      expect(html).toContain('bg-gray-100');
      expect(html).toContain('text-gray-800');
    });

    it('should apply primary variant', () => {
      const html = badge('Test', { variant: 'primary' });
      expect(html).toContain('bg-primary/10');
      expect(html).toContain('text-primary');
    });

    it('should apply secondary variant', () => {
      const html = badge('Test', { variant: 'secondary' });
      expect(html).toContain('bg-secondary/10');
    });

    it('should apply success variant', () => {
      const html = badge('Test', { variant: 'success' });
      expect(html).toContain('bg-success/10');
    });

    it('should apply warning variant', () => {
      const html = badge('Test', { variant: 'warning' });
      expect(html).toContain('bg-warning/10');
    });

    it('should apply danger variant', () => {
      const html = badge('Test', { variant: 'danger' });
      expect(html).toContain('bg-danger/10');
    });

    it('should apply info variant', () => {
      const html = badge('Test', { variant: 'info' });
      expect(html).toContain('bg-blue-100');
    });

    it('should apply outline variant', () => {
      const html = badge('Test', { variant: 'outline' });
      expect(html).toContain('border-border');
      expect(html).toContain('bg-transparent');
    });

    it('should apply size classes', () => {
      const sizes = ['sm', 'md', 'lg'] as const;
      for (const size of sizes) {
        const html = badge('Test', { size });
        expect(html).toContain('px-');
      }
    });

    it('should apply pill styling', () => {
      const html = badge('Test', { pill: true });
      expect(html).toContain('rounded-full');
    });

    it('should not apply pill styling by default', () => {
      const html = badge('Test');
      expect(html).toContain('rounded-md');
    });

    it('should render icon', () => {
      const html = badge('Test', { icon: '<svg>icon</svg>' });
      expect(html).toContain('<svg>icon</svg>');
      expect(html).toContain('mr-1');
    });

    it('should render dot badge', () => {
      const html = badge('Status', { dot: true });
      expect(html).toContain('rounded-full');
      expect(html).toContain('aria-label="Status"');
      expect(html).toContain('title="Status"');
    });

    it('should apply dot variant styles', () => {
      const html = badge('Online', { dot: true, variant: 'success' });
      expect(html).toContain('bg-success');
    });

    it('should apply dot size classes', () => {
      const sizes = ['sm', 'md', 'lg'] as const;
      for (const size of sizes) {
        const html = badge('Test', { dot: true, size });
        expect(html).toContain('w-');
        expect(html).toContain('h-');
      }
    });

    it('should apply custom className', () => {
      const html = badge('Test', { className: 'custom-class' });
      expect(html).toContain('custom-class');
    });

    it('should render removable badge', () => {
      const html = badge('Test', { removable: true });
      expect(html).toContain('<button');
      expect(html).toContain('aria-label="Remove"');
    });

    it('should escape text to prevent XSS', () => {
      const html = badge('<script>alert("xss")</script>');
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('badgeGroup', () => {
    const badges = [badge('One'), badge('Two'), badge('Three')];

    it('should wrap badges in container', () => {
      const html = badgeGroup(badges);
      expect(html).toContain('One');
      expect(html).toContain('Two');
      expect(html).toContain('Three');
    });

    it('should apply gap classes', () => {
      const gaps = ['sm', 'md', 'lg'] as const;
      for (const gap of gaps) {
        const html = badgeGroup(badges, { gap });
        expect(html).toContain('gap-');
      }
    });

    it('should apply custom className', () => {
      const html = badgeGroup(badges, { className: 'custom-group' });
      expect(html).toContain('custom-group');
    });
  });

  describe('Status Badge Presets', () => {
    it('activeBadge should create success variant', () => {
      const html = activeBadge();
      expect(html).toContain('Active');
      expect(html).toContain('bg-success');
    });

    it('activeBadge should accept custom text', () => {
      const html = activeBadge('Running');
      expect(html).toContain('Running');
    });

    it('inactiveBadge should create default variant', () => {
      const html = inactiveBadge();
      expect(html).toContain('Inactive');
      expect(html).toContain('bg-gray-100');
    });

    it('pendingBadge should create warning variant', () => {
      const html = pendingBadge();
      expect(html).toContain('Pending');
      expect(html).toContain('bg-warning');
    });

    it('errorBadge should create danger variant', () => {
      const html = errorBadge();
      expect(html).toContain('Error');
      expect(html).toContain('bg-danger');
    });

    it('newBadge should create primary pill variant', () => {
      const html = newBadge();
      expect(html).toContain('New');
      expect(html).toContain('rounded-full');
    });

    it('betaBadge should create secondary pill variant', () => {
      const html = betaBadge();
      expect(html).toContain('Beta');
      expect(html).toContain('rounded-full');
    });
  });

  describe('Status Dot Presets', () => {
    it('onlineDot should create success dot', () => {
      const html = onlineDot();
      expect(html).toContain('aria-label="Online"');
      expect(html).toContain('bg-success');
    });

    it('offlineDot should create default dot', () => {
      const html = offlineDot();
      expect(html).toContain('aria-label="Offline"');
      expect(html).toContain('bg-gray-400');
    });

    it('busyDot should create danger dot', () => {
      const html = busyDot();
      expect(html).toContain('aria-label="Busy"');
      expect(html).toContain('bg-danger');
    });

    it('awayDot should create warning dot', () => {
      const html = awayDot();
      expect(html).toContain('aria-label="Away"');
      expect(html).toContain('bg-warning');
    });
  });
});
