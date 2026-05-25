# Test & Coverage Summary

> Last updated: 2026-05-25

## Overview

| Library         | Tests | Stmts  | Branches | Funcs  | Lines  | Status    |
| --------------- | ----- | ------ | -------- | ------ | ------ | --------- |
| sdk             | 3,458 | 51.32% | 36.81%   | 49.96% | 51.76% | ⚠️ Medium |
| auth            | 2,213 | 89.63% | 82.26%   | 58.41% | 90.58% | 🟢 Good   |
| utils           | 1,644 | 93.66% | 89.69%   | 96.40% | 94.02% | ✅ Good   |
| cli             | 1,214 | 59.98% | 56.67%   | 61.77% | 60.54% | ⚠️ Medium |
| adapters        | 691   | 91.11% | 85.92%   | 86.80% | 92.69% | 🟢 Good   |
| observability   | 460   | 96.08% | 88.50%   | 94.69% | 97.48% | ✅ Good   |
| ui              | 386   | 46.88% | 28.26%   | 50.15% | 46.96% | ⚠️ Medium |
| uipack          | 267   | 69.28% | 53.64%   | 68.55% | 69.23% | ⚠️ Medium |
| plugin-approval | 249   | 97.01% | 89.73%   | 98.21% | 98.13% | ✅ Good   |
| di              | 241   | 83.94% | 73.74%   | 96.96% | 84.83% | 🟢 Good   |
| guard           | 200   | 99.74% | 99.38%   | 100%   | 100%   | ✅ Good   |
| plugin-cache    | 141   | 98.38% | 92.39%   | 100%   | 98.26% | ✅ Good   |
| storage-sqlite  | 129   | 96.89% | 87.17%   | 93.45% | 98.06% | ✅ Good   |

## Total Tests: 11,393+ passed

---

## Coverage Notes

### SDK Coverage

The SDK (`libs/sdk`) coverage rose from 38.3% → 51.32% statements as test
suites added during recent feature work (issues #399 / #401 / #411 / #417)
exercise more of the metrics, bridge, sqlite-autowire, transport, and CLI
extension paths. Coverage collection still excludes:

- Barrel exports (`index.ts` files)
- Test utilities (`__test-utils__/`)

Increasing coverage further is an ongoing effort — the package is
~26,800 instrumented statements, so each fixture push moves the needle
by a small percentage.

### CLI Coverage

`libs/cli` jumped from no published number to 59.98% statements / 1,214
tests as the dev-bridge, eject, install, and project-command extension
test suites landed. Build / scaffold paths still dominate the
uncovered statements — the integration-heavy code paths sit behind
`apps/e2e/` rather than unit tests.

### UI Packages (ui, uipack)

Both packages are React-heavy and rely on visual / SSR tests:

- **libs/uipack**: React-free bundling, platform adapters, theming (267 tests)
- **libs/ui**: React components, SSR rendering, HTML components (386 tests)

These have significant coverage but achieving 90%+ across all modules is
a work in progress due to size and the cost of SSR snapshots.

### Plugin Coverage

Plugins maintain stricter coverage requirements:

- **plugin-approval**: 97%+ statements, 89%+ branches (approval workflows)
- **plugin-cache**: 98%+ statements, 92%+ branches (caching layer)

### Storage / Observability / Guard

- **storage-sqlite**: 96.89% statements, 98.06% lines — exercised by both
  the in-package suite and the SDK auto-wire tests.
- **observability**: 96.08% statements — bumped via the metrics endpoint
  work (issue #397) and the SQLite-aware transport teardown (#401).
- **guard**: 99.74% statements, 100% lines / functions — effectively
  fully covered by the schema-validation suite.

---

## Detailed Reports

### sdk

```text
Tests:       3,458 passed, 3,458 total
Statements : 51.32% ( 13751/26794 )
Branches   : 36.81% ( 4993/13562 )
Functions  : 49.96% ( 2640/5284 )
Lines      : 51.76% ( 13126/25356 )
```

### auth

```text
Tests:       2,213 passed, 2,213 total
Statements : 89.63% ( 3684/4110 )
Branches   : 82.26% ( 1656/2013 )
Functions  : 58.41% ( 701/1200 )
Lines      : 90.58% ( 3475/3836 )
```

### utils

```text
Tests:       1,644 passed, 1,644 total
Statements : 93.66% ( 2470/2637 )
Branches   : 89.69% ( 1193/1330 )
Functions  : 96.40% ( 698/724 )
Lines      : 94.02% ( 2315/2462 )
```

### cli

```text
Tests:       1,214 passed, 1,214 total
Statements : 59.98% ( 3426/5711 )
Branches   : 56.67% ( 1838/3243 )
Functions  : 61.77% ( 648/1049 )
Lines      : 60.54% ( 3146/5196 )
```

### adapters

```text
Tests:       691 passed, 691 total
Statements : 91.11% ( 2081/2284 )
Branches   : 85.92% ( 1227/1428 )
Functions  : 86.80% ( 329/379 )
Lines      : 92.69% ( 1941/2094 )
```

### observability

```text
Tests:       460 passed, 460 total
Statements : 96.08% ( 1814/1888 )
Branches   : 88.50% ( 893/1009 )
Functions  : 94.69% ( 446/471 )
Lines      : 97.48% ( 1592/1633 )
```

### ui

```text
Tests:       386 passed, 386 total
Statements : 46.88% ( 955/2037 )
Branches   : 28.26% ( 264/934 )
Functions  : 50.15% ( 314/626 )
Lines      : 46.96% ( 881/1876 )
```

### uipack

```text
Tests:       267 passed, 267 total
Statements : 69.28% ( 1076/1553 )
Branches   : 53.64% ( 405/755 )
Functions  : 68.55% ( 242/353 )
Lines      : 69.23% ( 1026/1482 )
```

### plugin-approval

```text
Tests:       249 passed, 249 total
Statements : 97.01%
Branches   : 89.73%
Functions  : 98.21%
Lines      : 98.13%
```

### di

```text
Tests:       241 passed (1 todo), 242 total
Statements : 83.94% ( 575/685 )
Branches   : 73.74% ( 278/377 )
Functions  : 96.96% ( 128/132 )
Lines      : 84.83% ( 526/620 )
```

### guard

```text
Tests:       200 passed, 200 total
Statements : 99.74% ( 398/399 )
Branches   : 99.38% ( 161/162 )
Functions  : 100%   ( 92/92 )
Lines      : 100%   ( 369/369 )
```

### plugin-cache

```text
Tests:       141 passed, 141 total
Statements : 98.38% ( 243/247 )
Branches   : 92.39% ( 158/171 )
Functions  : 100%   ( 44/44 )
Lines      : 98.26% ( 226/230 )
```

### storage-sqlite

```text
Tests:       129 passed, 129 total
Statements : 96.89% ( 374/386 )
Branches   : 87.17% ( 136/156 )
Functions  : 93.45% ( 100/107 )
Lines      : 98.06% ( 355/362 )
```

---

## Running Tests

```bash
# Run all tests with coverage
yarn nx run-many -t test --coverage

# Run specific library tests
yarn nx test sdk --coverage
yarn nx test cli --coverage
yarn nx test auth --coverage
yarn nx test utils --coverage
yarn nx test observability --coverage
yarn nx test adapters --coverage
yarn nx test ui --coverage
yarn nx test uipack --coverage
yarn nx test plugin-approval --coverage
yarn nx test plugin-cache --coverage
yarn nx test storage-sqlite --coverage
yarn nx test di --coverage
yarn nx test guard --coverage
```

## Coverage Thresholds

Each package defines its own coverage thresholds in `jest.config.ts`:

| Package         | Statements | Branches | Functions | Lines |
| --------------- | ---------- | -------- | --------- | ----- |
| plugin-approval | 95%        | 88%      | 94%       | 95%   |
| plugin-cache    | 98%        | 92%      | 100%      | 98%   |
| observability   | 95%        | 88%      | 93%       | met   |
| storage-sqlite  | 95%        | 85%      | 90%       | 95%   |
| guard           | 99%        | 99%      | 100%      | 100%  |
| utils           | 92%        | 88%      | 95%       | 93%   |
| adapters        | 90%        | 85%      | 85%       | 92%   |
| ui              | 90%\*      | 90%\*    | 90%\*     | 90%\* |
| uipack          | 90%\*      | 90%\*    | 90%\*     | 90%\* |

\* Currently below threshold — coverage improvement in progress
