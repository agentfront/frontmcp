import {
  input,
  select,
  textarea,
  checkbox,
  radioGroup,
  form,
  formRow,
  formSection,
  formActions,
  hiddenInput,
  csrfInput,
} from './form';

describe('Form Components', () => {
  describe('input', () => {
    it('should render text input by default', () => {
      const html = input({ name: 'email' });
      expect(html).toContain('type="text"');
      expect(html).toContain('name="email"');
    });

    it('should render specific input types', () => {
      const types = ['email', 'password', 'number', 'tel', 'url'] as const;
      for (const type of types) {
        const html = input({ name: 'field', type });
        expect(html).toContain(`type="${type}"`);
      }
    });

    it('should set input id (defaults to name)', () => {
      const html = input({ name: 'email' });
      expect(html).toContain('id="email"');
    });

    it('should set custom id', () => {
      const html = input({ name: 'email', id: 'custom-id' });
      expect(html).toContain('id="custom-id"');
    });

    it('should set value', () => {
      const html = input({ name: 'email', value: 'test@example.com' });
      expect(html).toContain('value="test@example.com"');
    });

    it('should set placeholder', () => {
      const html = input({ name: 'email', placeholder: 'Enter email' });
      expect(html).toContain('placeholder="Enter email"');
    });

    it('should render label', () => {
      const html = input({ name: 'email', label: 'Email Address' });
      expect(html).toContain('<label');
      expect(html).toContain('Email Address');
    });

    it('should show required indicator in label', () => {
      const html = input({ name: 'email', label: 'Email', required: true });
      expect(html).toContain('*');
      expect(html).toContain('required');
    });

    it('should render helper text', () => {
      const html = input({
        name: 'email',
        helper: 'We will never share your email',
      });
      expect(html).toContain('We will never share your email');
    });

    it('should render error message', () => {
      const html = input({
        name: 'email',
        error: 'Invalid email address',
      });
      expect(html).toContain('Invalid email address');
      expect(html).toContain('text-danger');
    });

    it('should apply error state styling', () => {
      const html = input({ name: 'email', error: 'Error' });
      expect(html).toContain('border-danger');
    });

    it('should apply success state styling', () => {
      const html = input({ name: 'email', state: 'success' });
      expect(html).toContain('border-success');
    });

    it('should apply size classes', () => {
      const sizes = ['sm', 'md', 'lg'] as const;
      for (const size of sizes) {
        const html = input({ name: 'field', size });
        expect(html).toContain('px-');
      }
    });

    it('should handle disabled state', () => {
      const html = input({ name: 'email', disabled: true });
      expect(html).toContain('disabled');
      expect(html).toContain('opacity-50');
    });

    it('should handle readonly state', () => {
      const html = input({ name: 'email', readonly: true });
      expect(html).toContain('readonly');
    });

    it('should set autocomplete', () => {
      const html = input({ name: 'email', autocomplete: 'email' });
      expect(html).toContain('autocomplete="email"');
    });

    it('should set pattern', () => {
      const html = input({ name: 'code', pattern: '[0-9]{6}' });
      expect(html).toContain('pattern="[0-9]{6}"');
    });

    it('should set min/max for number inputs', () => {
      const html = input({
        name: 'age',
        type: 'number',
        min: 18,
        max: 120,
      });
      expect(html).toContain('min="18"');
      expect(html).toContain('max="120"');
    });

    it('should render icon before input', () => {
      const html = input({
        name: 'email',
        iconBefore: '<svg>icon</svg>',
      });
      expect(html).toContain('<svg>icon</svg>');
    });

    it('should escape value to prevent XSS', () => {
      const html = input({
        name: 'email',
        value: '"><script>alert("xss")</script>',
      });
      expect(html).not.toContain('<script>');
    });
  });

  describe('select', () => {
    const options = [
      { value: 'us', label: 'United States' },
      { value: 'uk', label: 'United Kingdom' },
      { value: 'ca', label: 'Canada' },
    ];

    it('should render select element', () => {
      const html = select({ name: 'country', options });
      expect(html).toContain('<select');
      expect(html).toContain('</select>');
    });

    it('should render all options', () => {
      const html = select({ name: 'country', options });
      expect(html).toContain('United States');
      expect(html).toContain('United Kingdom');
      expect(html).toContain('Canada');
    });

    it('should mark selected option', () => {
      const html = select({ name: 'country', options, value: 'uk' });
      expect(html).toContain('value="uk" selected');
    });

    it('should mark disabled options', () => {
      const optionsWithDisabled = [...options, { value: 'disabled', label: 'Disabled', disabled: true }];
      const html = select({ name: 'country', options: optionsWithDisabled });
      expect(html).toContain('disabled');
    });

    it('should support multiple selection', () => {
      const html = select({ name: 'countries', options, multiple: true });
      expect(html).toContain('multiple');
    });

    it('should render label', () => {
      const html = select({
        name: 'country',
        options,
        label: 'Select Country',
      });
      expect(html).toContain('Select Country');
    });
  });

  describe('textarea', () => {
    it('should render textarea element', () => {
      const html = textarea({ name: 'bio' });
      expect(html).toContain('<textarea');
      expect(html).toContain('</textarea>');
    });

    it('should set rows', () => {
      const html = textarea({ name: 'bio', rows: 10 });
      expect(html).toContain('rows="10"');
    });

    it('should set value as content', () => {
      const html = textarea({ name: 'bio', value: 'My bio text' });
      expect(html).toContain('My bio text');
    });

    it('should apply resize classes', () => {
      const resizes = ['none', 'vertical', 'horizontal', 'both'] as const;
      for (const resize of resizes) {
        const html = textarea({ name: 'bio', resize });
        expect(html).toContain('resize');
      }
    });
  });

  describe('checkbox', () => {
    it('should render checkbox input', () => {
      const html = checkbox({ name: 'agree', label: 'I agree' });
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('I agree');
    });

    it('should set checked state', () => {
      const html = checkbox({ name: 'agree', label: 'I agree', checked: true });
      expect(html).toContain('checked');
    });

    it('should set value', () => {
      const html = checkbox({
        name: 'agree',
        label: 'I agree',
        value: 'yes',
      });
      expect(html).toContain('value="yes"');
    });

    it('should handle disabled state', () => {
      const html = checkbox({
        name: 'agree',
        label: 'I agree',
        disabled: true,
      });
      expect(html).toContain('disabled');
    });

    it('should render helper text', () => {
      const html = checkbox({
        name: 'agree',
        label: 'I agree',
        helper: 'Please read terms first',
      });
      expect(html).toContain('Please read terms first');
    });
  });

  describe('radioGroup', () => {
    const options = [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' },
    ];

    it('should render radio inputs', () => {
      const html = radioGroup({ name: 'size', options });
      expect(html).toContain('type="radio"');
      expect(html).toContain('Small');
      expect(html).toContain('Medium');
      expect(html).toContain('Large');
    });

    it('should set same name for all radios', () => {
      const html = radioGroup({ name: 'size', options });
      const matches = html.match(/name="size"/g);
      expect(matches?.length).toBe(3);
    });

    it('should mark selected value', () => {
      const html = radioGroup({ name: 'size', options, value: 'medium' });
      expect(html).toContain('value="medium"');
      expect(html).toContain('checked');
    });

    it('should apply horizontal direction', () => {
      const html = radioGroup({
        name: 'size',
        options,
        direction: 'horizontal',
      });
      expect(html).toContain('flex-row');
    });

    it('should render group label', () => {
      const html = radioGroup({
        name: 'size',
        options,
        label: 'Select Size',
      });
      expect(html).toContain('Select Size');
    });
  });

  describe('form', () => {
    it('should render form element', () => {
      const html = form('<input name="test">', {});
      expect(html).toContain('<form');
      expect(html).toContain('</form>');
    });

    it('should set action', () => {
      const html = form('<input>', { action: '/submit' });
      expect(html).toContain('action="/submit"');
    });

    it('should set method', () => {
      const html = form('<input>', { method: 'post' });
      expect(html).toContain('method="post"');
    });

    it('should set enctype for file uploads', () => {
      const html = form('<input type="file">', {
        enctype: 'multipart/form-data',
      });
      expect(html).toContain('enctype="multipart/form-data"');
    });
  });

  describe('formRow', () => {
    it('should render fields in a grid', () => {
      const html = formRow([input({ name: 'first' }), input({ name: 'last' })]);
      expect(html).toContain('grid');
    });
  });

  describe('formSection', () => {
    it('should render section with title', () => {
      const html = formSection('<input name="test">', {
        title: 'Personal Info',
      });
      expect(html).toContain('Personal Info');
      expect(html).toContain('<h3');
    });

    it('should render description', () => {
      const html = formSection('<input>', {
        title: 'Info',
        description: 'Enter your details',
      });
      expect(html).toContain('Enter your details');
    });
  });

  describe('formActions', () => {
    it('should render action buttons', () => {
      const html = formActions(['<button>Submit</button>']);
      expect(html).toContain('<button>Submit</button>');
    });

    it('should apply alignment', () => {
      const alignments = ['left', 'center', 'right', 'between'] as const;
      for (const align of alignments) {
        const html = formActions(['<button>Submit</button>'], { align });
        expect(html).toContain('justify-');
      }
    });
  });

  describe('hiddenInput', () => {
    it('should render hidden input', () => {
      const html = hiddenInput('token', 'abc123');
      expect(html).toContain('type="hidden"');
      expect(html).toContain('name="token"');
      expect(html).toContain('value="abc123"');
    });
  });

  describe('csrfInput', () => {
    it('should render CSRF hidden input', () => {
      const html = csrfInput('csrf-token-value');
      expect(html).toContain('type="hidden"');
      expect(html).toContain('name="_csrf"');
      expect(html).toContain('value="csrf-token-value"');
    });
  });
});
