# Test & Coverage Summary

> Last updated: 2025-11-25

## Overview

| Library    | Tests | Stmts | Branches | Funcs | Lines | Status    |
| ---------- | ----- | ----- | -------- | ----- | ----- | --------- |
| ast-guard  | 356   | 89.5% | 76.5%    | 89.7% | 90.4% | ✅ Good   |
| vectoriadb | 357   | 82.9% | 81.0%    | 80.3% | 82.5% | ✅ Good   |
| plugins    | 101   | 78.2% | 60.7%    | 61.0% | 79.9% | ⚠️ Medium |
| adapters   | 70    | 72.2% | 61.5%    | 74.0% | 72.2% | ⚠️ Medium |
| enclave    | 168   | 71.6% | 56.3%    | 75.0% | 71.9% | ⚠️ Medium |
| sdk        | 125   | 37.0% | 7.0%     | 17.5% | 38.1% | ❌ Low    |

## Total Tests: 1,177 passed (1 skipped)

---

## Detailed Reports

### ast-guard

```text
Tests:       356 passed, 356 total
Statements : 89.49% ( 724/809 )
Branches   : 76.53% ( 636/831 )
Functions  : 89.70% ( 122/136 )
Lines      : 90.39% ( 706/781 )
```

### enclave

```text
Tests:       168 passed, 1 skipped, 169 total
Statements : 71.62% ( 106/148 )
Branches   : 56.33% ( 40/71 )
Functions  : 75.00% ( 15/20 )
Lines      : 71.91% ( 105/146 )
```

### vectoriadb

```text
Tests:       357 passed, 357 total
Statements : 82.91% ( 665/802 )
Branches   : 80.95% ( 374/462 )
Functions  : 80.27% ( 118/147 )
Lines      : 82.46% ( 635/770 )
```

### sdk

```text
Tests:       125 passed, 125 total
Statements : 36.98% ( 3932/10630 )
Branches   : 6.97% ( 315/4516 )
Functions  : 17.51% ( 370/2112 )
Lines      : 38.08% ( 3838/10077 )
```

### adapters

```text
Tests:       70 passed, 70 total
Statements : 72.19% ( 174/241 )
Branches   : 61.53% ( 120/195 )
Functions  : 74.00% ( 37/50 )
Lines      : 72.17% ( 166/230 )
```

### plugins

```text
Tests:       101 passed, 101 total
Statements : 78.20% ( 122/156 )
Branches   : 60.68% ( 71/117 )
Functions  : 60.97% ( 25/41 )
Lines      : 79.86% ( 119/149 )
```

---

## Running Tests

```bash
# Run all tests with coverage
yarn nx run-many -t test --coverage

# Run specific library tests
yarn nx test ast-guard --coverage
yarn nx test enclave --coverage
yarn nx test vectoriadb --coverage
```
