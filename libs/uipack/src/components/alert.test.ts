import { alert, infoAlert, successAlert, warningAlert, dangerAlert, toast, toastContainer } from './alert';

describe('Alert Component', () => {
  describe('alert', () => {
    it('should render basic alert', () => {
      const html = alert('Test message');
      expect(html).toContain('Test message');
      expect(html).toContain('role="alert"');
    });

    it('should apply info variant by default', () => {
      const html = alert('Test');
      expect(html).toContain('bg-blue-50');
      expect(html).toContain('text-blue-800');
    });

    it('should apply success variant', () => {
      const html = alert('Test', { variant: 'success' });
      expect(html).toContain('bg-success/10');
    });

    it('should apply warning variant', () => {
      const html = alert('Test', { variant: 'warning' });
      expect(html).toContain('bg-warning/10');
    });

    it('should apply danger variant', () => {
      const html = alert('Test', { variant: 'danger' });
      expect(html).toContain('bg-danger/10');
    });

    it('should apply neutral variant', () => {
      const html = alert('Test', { variant: 'neutral' });
      expect(html).toContain('bg-gray-50');
    });

    it('should render title when provided', () => {
      const html = alert('Message', { title: 'Alert Title' });
      expect(html).toContain('Alert Title');
      expect(html).toContain('<h3');
    });

    it('should show icon by default', () => {
      const html = alert('Test');
      expect(html).toContain('<svg');
    });

    it('should hide icon when showIcon is false', () => {
      const html = alert('Test', { showIcon: false });
      expect(html).not.toContain('flex-shrink-0');
    });

    it('should render custom icon', () => {
      const html = alert('Test', { icon: '<svg>custom</svg>' });
      expect(html).toContain('<svg>custom</svg>');
    });

    it('should render dismissible button', () => {
      const html = alert('Test', { dismissible: true });
      expect(html).toContain('aria-label="Dismiss"');
      expect(html).toContain('onclick=');
    });

    it('should set alert ID', () => {
      const html = alert('Test', { id: 'my-alert' });
      expect(html).toContain('id="my-alert"');
    });

    it('should render actions', () => {
      const html = alert('Test', { actions: '<button>Click</button>' });
      expect(html).toContain('<button>Click</button>');
    });

    it('should apply custom className', () => {
      const html = alert('Test', { className: 'custom-alert' });
      expect(html).toContain('custom-alert');
    });

    it('should escape message to prevent XSS', () => {
      const html = alert('<script>alert("xss")</script>');
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('Alert Presets', () => {
    it('infoAlert should create info variant', () => {
      const html = infoAlert('Info message');
      expect(html).toContain('Info message');
      expect(html).toContain('bg-blue-50');
    });

    it('successAlert should create success variant', () => {
      const html = successAlert('Success message');
      expect(html).toContain('Success message');
      expect(html).toContain('bg-success/10');
    });

    it('warningAlert should create warning variant', () => {
      const html = warningAlert('Warning message');
      expect(html).toContain('Warning message');
      expect(html).toContain('bg-warning/10');
    });

    it('dangerAlert should create danger variant', () => {
      const html = dangerAlert('Danger message');
      expect(html).toContain('Danger message');
      expect(html).toContain('bg-danger/10');
    });

    it('should allow additional options with presets', () => {
      const html = infoAlert('Message', { dismissible: true });
      expect(html).toContain('aria-label="Dismiss"');
    });
  });

  describe('toast', () => {
    it('should render toast notification', () => {
      const html = toast('Toast message');
      expect(html).toContain('Toast message');
      expect(html).toContain('role="alert"');
      expect(html).toContain('z-50');
    });

    it('should apply info variant by default', () => {
      const html = toast('Test');
      expect(html).toContain('bg-blue-50');
    });

    it('should apply variant classes', () => {
      const html = toast('Test', { variant: 'success' });
      expect(html).toContain('bg-success/10');
    });

    it('should render title', () => {
      const html = toast('Message', { title: 'Toast Title' });
      expect(html).toContain('Toast Title');
      expect(html).toContain('<h4');
    });

    it('should position toast correctly', () => {
      const positions = [
        'top-right',
        'top-left',
        'bottom-right',
        'bottom-left',
        'top-center',
        'bottom-center',
      ] as const;
      for (const position of positions) {
        const html = toast('Test', { position });
        expect(html).toContain('fixed');
      }
    });

    it('should generate unique ID', () => {
      const html = toast('Test');
      expect(html).toContain('id="toast-');
    });

    it('should use custom ID', () => {
      const html = toast('Test', { id: 'custom-toast' });
      expect(html).toContain('id="custom-toast"');
    });

    it('should include auto-dismiss script', () => {
      const html = toast('Test', { duration: 3000 });
      expect(html).toContain('<script>');
      expect(html).toContain('setTimeout');
      expect(html).toContain('3000');
    });

    it('should not include auto-dismiss script when duration is 0', () => {
      const html = toast('Test', { duration: 0 });
      expect(html).not.toContain('setTimeout');
    });

    it('should include close button', () => {
      const html = toast('Test');
      expect(html).toContain('aria-label="Close"');
    });
  });

  describe('toastContainer', () => {
    it('should render toast container', () => {
      const html = toastContainer();
      expect(html).toContain('id="toast-container"');
      expect(html).toContain('z-50');
    });

    it('should apply position classes', () => {
      const html = toastContainer('bottom-left');
      expect(html).toContain('bottom-4');
      expect(html).toContain('left-4');
    });

    it('should use custom ID', () => {
      const html = toastContainer('top-right', 'my-toasts');
      expect(html).toContain('id="my-toasts"');
    });
  });
});
