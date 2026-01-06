# Test & Coverage Summary

> Last updated: 2026-01-06

## Overview

| Library         | Tests | Stmts | Branches | Funcs | Lines | Status    |
| --------------- | ----- | ----- | -------- | ----- | ----- | --------- |
| sdk             | 1,316 | 38.3% | 21.1%    | 30.0% | 38.5% | ⚠️ Medium |
| uipack          | 941   | 48.0% | 39.5%    | 47.1% | 47.5% | ⚠️ Medium |
| ui              | 514   | 36.9% | 40.1%    | 37.1% | 36.2% | ⚠️ Medium |
| plugin-approval | 231   | 95.6% | 88.4%    | 94.6% | 96.6% | ✅ Good   |
| plugin-cache    | 141   | 98.4% | 92.4%    | 100%  | 98.3% | ✅ Good   |

## Total Tests: 3,143+ passed

---

## Coverage Notes

### SDK Coverage

The SDK (`libs/sdk`) has lower coverage due to its extensive codebase (~15,000 lines). Coverage collection excludes:

- Barrel exports (`index.ts` files)
- Test utilities (`__test-utils__/`)

The 1,316 tests focus on core functionality. Increasing coverage is an ongoing effort.

### UI Packages (ui, uipack)

Both `libs/ui` and `libs/uipack` are large packages with extensive functionality:

- **libs/uipack**: React-free bundling, platform adapters, theming (941 tests)
- **libs/ui**: React components, SSR rendering, HTML components (514 tests)

These packages have significant test coverage but achieving 90%+ across all modules is a work in progress due to their size and complexity.

### Plugin Coverage

Plugins maintain stricter coverage requirements:

- **plugin-approval**: 95%+ statements, 88%+ branches (approval workflows)
- **plugin-cache**: 98%+ statements, 92%+ branches (caching layer)

---

## Detailed Reports

### sdk

```text
Tests:       1,316 passed, 1,316 total
Statements : 38.26% ( 6362/16624 )
Branches   : 21.10% ( 1575/7464 )
Functions  : 30.01% ( 1205/4014 )
Lines      : 38.50% ( 6068/15757 )
```

### uipack

```text
Tests:       941 passed, 941 total
Statements : 48.03%
Branches   : 39.54%
Functions  : 47.14%
Lines      : 47.51%
```

### ui

```text
Tests:       514 passed (3 skipped), 517 total
Statements : 36.85%
Branches   : 40.12%
Functions  : 37.11%
Lines      : 36.23%
```

### plugin-approval

```text
Tests:       231 passed, 231 total
Statements : 95.60%
Branches   : 88.41%
Functions  : 94.64%
Lines      : 96.63%
```

### plugin-cache

```text
Tests:       141 passed, 141 total
Statements : 98.38%
Branches   : 92.39%
Functions  : 100.00%
Lines      : 98.26%
```

---

## Running Tests

```bash
# Run all tests with coverage
yarn nx run-many -t test --coverage

# Run specific library tests
yarn nx test sdk --coverage
yarn nx test ui --coverage
yarn nx test uipack --coverage
yarn nx test plugin-approval --coverage
yarn nx test plugin-cache --coverage
```

## Coverage Thresholds

Each package defines its own coverage thresholds in `jest.config.ts`:

| Package         | Statements | Branches | Functions | Lines |
| --------------- | ---------- | -------- | --------- | ----- |
| plugin-approval | 95%        | 88%      | 94%       | 95%   |
| plugin-cache    | 98%        | 92%      | 100%      | 98%   |
| ui              | 90%\*      | 90%\*    | 90%\*     | 90%\* |
| uipack          | 90%\*      | 90%\*    | 90%\*     | 90%\* |

\* Currently below threshold - coverage improvement in progress
