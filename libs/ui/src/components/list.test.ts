import {
  permissionList,
  featureList,
  descriptionList,
  actionList,
  PermissionItem,
  FeatureItem,
  DescriptionItem,
  ActionItem,
} from './list';

describe('List Components', () => {
  describe('permissionList', () => {
    const permissions: PermissionItem[] = [
      { scope: 'read:profile', name: 'Read Profile', description: 'View your profile' },
      { scope: 'write:email', name: 'Write Email', required: true },
      { scope: 'delete:data', name: 'Delete Data', sensitive: true },
    ];

    it('should render permission items', () => {
      const html = permissionList(permissions);
      expect(html).toContain('Read Profile');
      expect(html).toContain('Write Email');
      expect(html).toContain('Delete Data');
    });

    it('should render description when provided', () => {
      const html = permissionList(permissions);
      expect(html).toContain('View your profile');
    });

    it('should show required label', () => {
      const html = permissionList(permissions);
      expect(html).toContain('(Required)');
    });

    it('should show sensitive warning', () => {
      const html = permissionList(permissions);
      expect(html).toContain('Sensitive');
      expect(html).toContain('border-warning');
    });

    it('should render checkboxes when checkable', () => {
      const html = permissionList(permissions, { checkable: true });
      expect(html).toContain('type="checkbox"');
    });

    it('should check required permissions', () => {
      const html = permissionList(permissions, { checkable: true });
      expect(html).toContain('checked');
      expect(html).toContain('disabled');
    });

    it('should use custom input name', () => {
      const html = permissionList(permissions, { checkable: true, inputName: 'perms' });
      expect(html).toContain('name="perms[]"');
    });

    it('should render title', () => {
      const html = permissionList(permissions, { title: 'Permissions' });
      expect(html).toContain('Permissions');
      expect(html).toContain('<h4');
    });

    it('should set list ID', () => {
      const html = permissionList(permissions, { id: 'perm-list' });
      expect(html).toContain('id="perm-list"');
    });

    it('should apply custom className', () => {
      const html = permissionList(permissions, { className: 'custom-list' });
      expect(html).toContain('custom-list');
    });

    it('should use appropriate icons for scope types', () => {
      const html = permissionList(permissions);
      expect(html).toContain('<svg'); // Icons present
    });

    it('should use custom icon when provided', () => {
      const permsWithIcon: PermissionItem[] = [{ scope: 'custom', name: 'Custom', icon: '<svg>custom</svg>' }];
      const html = permissionList(permsWithIcon);
      expect(html).toContain('<svg>custom</svg>');
    });

    it('should check items with checked flag', () => {
      const permsChecked: PermissionItem[] = [{ scope: 'test', name: 'Test', checked: true }];
      const html = permissionList(permsChecked, { checkable: true });
      expect(html).toContain('checked');
    });
  });

  describe('featureList', () => {
    const features: FeatureItem[] = [
      { name: 'Feature 1', description: 'Description 1' },
      { name: 'Feature 2', included: true },
      { name: 'Feature 3', included: false },
    ];

    it('should render feature items', () => {
      const html = featureList(features);
      expect(html).toContain('Feature 1');
      expect(html).toContain('Feature 2');
      expect(html).toContain('Feature 3');
    });

    it('should render description', () => {
      const html = featureList(features);
      expect(html).toContain('Description 1');
    });

    it('should show check style by default', () => {
      const html = featureList(features, { style: 'check' });
      expect(html).toContain('<svg');
    });

    it('should show bullet style', () => {
      const html = featureList(features, { style: 'bullet' });
      expect(html).toContain('rounded-full');
    });

    it('should show number style', () => {
      const html = featureList(features, { style: 'number' });
      expect(html).toContain('1.');
      expect(html).toContain('2.');
    });

    it('should style excluded features differently', () => {
      const html = featureList(features);
      expect(html).toContain('line-through');
    });

    it('should use custom included icon', () => {
      const html = featureList(features, { includedIcon: '<svg>included</svg>' });
      expect(html).toContain('<svg>included</svg>');
    });

    it('should use custom excluded icon', () => {
      const html = featureList(features, { excludedIcon: '<svg>excluded</svg>' });
      expect(html).toContain('<svg>excluded</svg>');
    });

    it('should apply custom className', () => {
      const html = featureList(features, { className: 'custom-features' });
      expect(html).toContain('custom-features');
    });
  });

  describe('descriptionList', () => {
    const items: DescriptionItem[] = [
      { term: 'Name', description: 'John Doe' },
      { term: 'Email', description: 'john@example.com', copyable: true },
    ];

    it('should render term and description', () => {
      const html = descriptionList(items);
      expect(html).toContain('Name');
      expect(html).toContain('John Doe');
    });

    it('should render stacked layout by default', () => {
      const html = descriptionList(items, { layout: 'stacked' });
      expect(html).toContain('<dl');
      expect(html).toContain('<dt');
      expect(html).toContain('<dd');
    });

    it('should render horizontal layout', () => {
      const html = descriptionList(items, { layout: 'horizontal' });
      expect(html).toContain('sm:grid');
      expect(html).toContain('sm:grid-cols-3');
    });

    it('should render grid layout', () => {
      const html = descriptionList(items, { layout: 'grid' });
      expect(html).toContain('grid');
      expect(html).toContain('grid-cols-2');
    });

    it('should show dividers when enabled', () => {
      const html = descriptionList(items, { dividers: true });
      expect(html).toContain('border-b');
    });

    it('should show copy button for copyable items', () => {
      const html = descriptionList(items);
      expect(html).toContain('copyToClipboard');
    });

    it('should include copy script when copyable items exist', () => {
      const html = descriptionList(items);
      expect(html).toContain('<script>');
      expect(html).toContain('navigator.clipboard');
    });

    it('should apply custom className', () => {
      const html = descriptionList(items, { className: 'custom-dl' });
      expect(html).toContain('custom-dl');
    });
  });

  describe('actionList', () => {
    const actions: ActionItem[] = [
      { label: 'Edit', description: 'Edit this item', href: '/edit' },
      { label: 'Delete', destructive: true, htmx: { post: '/delete' } },
      { label: 'Disabled', disabled: true },
    ];

    it('should render action items', () => {
      const html = actionList(actions);
      expect(html).toContain('Edit');
      expect(html).toContain('Delete');
      expect(html).toContain('Disabled');
    });

    it('should render description', () => {
      const html = actionList(actions);
      expect(html).toContain('Edit this item');
    });

    it('should render as link when href provided', () => {
      const html = actionList(actions);
      expect(html).toContain('<a href="/edit"');
    });

    it('should style destructive actions', () => {
      const html = actionList(actions);
      expect(html).toContain('text-danger');
    });

    it('should style disabled actions', () => {
      const html = actionList(actions);
      expect(html).toContain('opacity-50');
      expect(html).toContain('cursor-not-allowed');
    });

    it('should render icon when provided', () => {
      const actionsWithIcon: ActionItem[] = [{ label: 'Settings', icon: '<svg>settings</svg>' }];
      const html = actionList(actionsWithIcon);
      expect(html).toContain('<svg>settings</svg>');
    });

    it('should apply custom className', () => {
      const html = actionList(actions, 'custom-actions');
      expect(html).toContain('custom-actions');
    });
  });
});
