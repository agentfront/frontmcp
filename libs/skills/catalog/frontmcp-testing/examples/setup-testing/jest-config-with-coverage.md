---
name: jest-config-with-coverage
reference: setup-testing
level: basic
description: 'Set up a Jest configuration file that enforces 95%+ coverage across all metrics for a FrontMCP library.'
tags: [testing, jest, setup, config, coverage]
features:
  - 'How to configure Jest with `ts-jest` for TypeScript test files'
  - 'Setting 95%+ coverage thresholds required by FrontMCP standards'
  - 'Proper `tsconfig.spec.json` that extends the base config and includes `.spec.ts` files'
---

# Jest Configuration with Coverage Thresholds

Set up a Jest configuration file that enforces 95%+ coverage across all metrics for a FrontMCP library.

## Code

```typescript
// jest.config.ts
export default {
  displayName: 'my-lib',
  preset: '../../jest.preset.js',
  transform: {
    // Must cover `.js` too: `transformIgnorePatterns` only un-ignores a file,
    // the transform still has to match it. An ESM dep's `.js` would otherwise
    // reach Jest untransformed.
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // ESM-only deps (jose, reached via @frontmcp/sdk) must be transpiled, not
  // ignored. The `.pnpm` skip keeps this correct under pnpm's symlinked store.
  transformIgnorePatterns: ['node_modules[/\\\\](?!\\.pnpm[/\\\\])(?!(jose)[/\\\\])'],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
};
```

```json
// tsconfig.spec.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "allowJs": true,
    "types": ["jest", "node"]
  },
  "include": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.spec.tsx"]
}
```

## What This Demonstrates

- How to configure Jest with `ts-jest` for TypeScript test files
- Setting 95%+ coverage thresholds required by FrontMCP standards
- Proper `tsconfig.spec.json` that extends the base config and includes `.spec.ts` files

## Related

- See `setup-testing` for the full testing setup reference
