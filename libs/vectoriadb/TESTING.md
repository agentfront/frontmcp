# VectoriaDB Testing Guide

## Test Suite Overview

VectoriaDB includes comprehensive tests covering all functionality with **100% API coverage**.

## Quick Start

```bash
# Run all tests
nx test vectoriadb

# Run with coverage report
nx test vectoriadb --coverage

# Run in watch mode (for development)
nx test vectoriadb --watch

# Run specific test file
nx test vectoriadb --testFile=similarity.test.ts
```

## Test Files

### 1. `similarity.test.ts` (Fast - No Model Required)

Tests vector similarity utilities:

- ✅ 15 tests covering cosine similarity, normalization, euclidean distance, dot product
- ⚡ **Fast**: < 1 second
- 🎯 **Zero dependencies**: Pure math calculations

**Run individually:**

```bash
nx test vectoriadb --testFile=similarity.test.ts
```

### 2. `embedding.test.ts` (Slow - Downloads Model First Time)

Tests embedding generation service:

- ✅ Tests for model initialization, single/batch embeddings, custom models
- ⏱️ **First run**: ~30-60 seconds (downloads 22MB model)
- ⚡ **Subsequent runs**: ~5-10 seconds (uses cached model)

**Important**: First run downloads the model to `.cache/transformers/`

### 3. `vectoria.test.ts` (Slow - Requires Model)

Tests main VectoriaDB functionality:

- ✅ Comprehensive tests for all CRUD operations, search, filtering
- ⏱️ **Runtime**: ~10-20 seconds
- 🔍 **Coverage**: All public API methods, edge cases, error handling

## Test Results

```text
PASS  vectoriadb  similarity.test.ts
  Similarity Utils
    cosineSimilarity
      ✓ should return 1 for identical vectors
      ✓ should return 0 for orthogonal vectors
      ✓ should return -1 for opposite vectors
      ✓ should handle similar but not identical vectors
      ✓ should throw error for vectors of different dimensions
      ✓ should return 0 for zero vectors
    normalizeVector
      ✓ should normalize a vector to unit length
      ✓ should handle already normalized vector
      ✓ should handle zero vector
    euclideanDistance
      ✓ should calculate distance between identical vectors as 0
      ✓ should calculate distance correctly
      ✓ should throw error for vectors of different dimensions
    dotProduct
      ✓ should calculate dot product correctly
      ✓ should return 0 for orthogonal vectors
      ✓ should throw error for vectors of different dimensions

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

## First-Time Setup

The first test run will:

1. Download the embedding model (~22MB)
2. Cache it in `./.cache/transformers/`
3. Take ~30-60 seconds

**Subsequent runs use the cached model and are much faster.**

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test VectoriaDB

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'

      # Cache the transformer models
      - name: Cache Transformers Models
        uses: actions/cache@v3
        with:
          path: .cache/transformers
          key: transformers-${{ runner.os }}-${{ hashFiles('libs/vectoriadb/package.json') }}
          restore-keys: |
            transformers-${{ runner.os }}-

      - name: Install dependencies
        run: yarn install

      - name: Run tests
        run: nx test vectoriadb --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/libs/vectoriadb/lcov.info
```

### Pre-download Model (Optional)

For faster CI builds, pre-download the model:

```bash
# Add to your CI setup script
node -e "
  import('@huggingface/transformers').then(async ({ pipeline }) => {
    await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('Model cached successfully');
  });
"
```

## Coverage

Run with coverage report:

```bash
nx test vectoriadb --coverage
```

Expected coverage:

- **Statements**: > 95%
- **Branches**: > 90%
- **Functions**: > 95%
- **Lines**: > 95%

Coverage report is generated in `coverage/libs/vectoriadb/`

## Debugging Tests

### Verbose output

```bash
nx test vectoriadb --verbose
```

### Run specific test by name

```bash
nx test vectoriadb -t "should add a document"
```

### Debug mode

```bash
node --inspect-brk node_modules/.bin/nx test vectoriadb
```

Then open `chrome://inspect` in Chrome and click "inspect".

## Writing New Tests

### Template

```typescript
import { VectoriaDB } from '../vectoria';
import { DocumentMetadata } from '../interfaces';

interface TestMetadata extends DocumentMetadata {
  id: string;
  category: string;
}

describe('MyFeature', () => {
  let db: VectoriaDB<TestMetadata>;

  beforeAll(async () => {
    db = new VectoriaDB<TestMetadata>();
    await db.initialize();
  }, 60000); // Timeout for model loading

  afterEach(() => {
    db.clear(); // Clean up between tests
  });

  test('should do something', async () => {
    await db.add('doc-1', 'content', {
      id: 'doc-1',
      category: 'test',
    });

    const results = await db.search('query');
    expect(results.length).toBeGreaterThan(0);
  });
});
```

### Best Practices

1. **Use `beforeAll` for initialization** - Don't re-initialize the model for each test
2. **Use `afterEach` to clear data** - Keep tests independent
3. **Set appropriate timeouts** - Model loading tests need 60s timeout
4. **Type your metadata** - Use TypeScript generics for type safety
5. **Test edge cases** - Empty inputs, non-existent IDs, etc.

## Troubleshooting

### Model Download Fails

**Problem**: Model download times out or fails

**Solution**:

```bash
# Delete cache and retry
rm -rf .cache/transformers
nx test vectoriadb
```

### Out of Memory

**Problem**: Tests fail with "JavaScript heap out of memory"

**Solution**:

```bash
# Increase Node.js memory
NODE_OPTIONS=--max-old-space-size=4096 nx test vectoriadb
```

### Tests Hang

**Problem**: Tests hang during initialization

**Solution**:

1. Check your internet connection (model download required)
2. Increase timeout in `jest.config.ts`
3. Check firewall settings (Hugging Face CDN access needed)

### Import Errors

**Problem**: `Cannot find module '@huggingface/transformers'`

**Solution**:

```bash
cd libs/vectoriadb
yarn install
```

## Performance Benchmarks

| Test Suite         | Tests   | Time (Cached) | Time (First Run) |
| ------------------ | ------- | ------------- | ---------------- |
| similarity.test.ts | 15      | < 1s          | < 1s             |
| embedding.test.ts  | ~10     | 5-10s         | 30-60s           |
| vectoria.test.ts   | ~40     | 10-20s        | 30-60s           |
| **Total**          | **~65** | **15-30s**    | **60-120s**      |

## Continuous Testing

For development with live reload:

```bash
nx test vectoriadb --watch
```

This will:

- ✅ Re-run tests on file changes
- ✅ Show only failed tests after first run
- ✅ Provide interactive mode for focused testing

Press `p` to filter by test file name
Press `t` to filter by test name
Press `q` to quit

## Test Configuration

Tests are configured in:

- `jest.config.ts` - Jest configuration
- `.spec.swcrc` - SWC transpiler settings
- `project.json` - NX test target

## Next Steps

After tests pass:

1. Build the library: `nx build vectoriadb`
2. Run integration tests (if any)
3. Check coverage report
4. Update documentation if needed

## Support

For test-related issues:

- Check the [test README](src/__tests__/README.md)
- Open an issue on GitHub
- Review [Jest documentation](https://jestjs.io/)
