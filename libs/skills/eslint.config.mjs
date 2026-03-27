import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['__tests__/skills-validation.spec.ts'],
    rules: {
      // The validation test imports the SDK parser via relative path because
      // the SDK barrel triggers CJS/ESM conflicts in skills Jest.
      // Disabling here prevents the rule's fix function from crashing on
      // a bad path resolution for @frontmcp/guard.
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
