# VectoriaDB Tests

Comprehensive test suite for VectoriaDB.

## Running Tests

```bash
# Run all tests
nx test vectoria

# Run tests in watch mode
nx test vectoria --watch

# Run tests with coverage
nx test vectoria --coverage

# Run specific test file
nx test vectoria --testFile=similarity.test.ts
```

## Test Structure

### `similarity.test.ts`

Tests for vector similarity utilities:

- Cosine similarity calculations
- Vector normalization
- Euclidean distance
- Dot product

**Fast**: No model loading required

### `embedding.test.ts`

Tests for the embedding service:

- Model initialization
- Single embedding generation
- Batch embedding generation
- Custom models

**Slow**: First run downloads the model (~22MB), subsequent runs use cached model

### `vectoria.test.ts`

Tests for the main VectoriaDB class:

- Document CRUD operations
- Semantic search
- Metadata filtering
- Statistics

**Slow**: Requires model for embeddings

## Test Coverage

The test suite covers:

- ✅ All public API methods
- ✅ Edge cases (empty inputs, non-existent IDs, etc.)
- ✅ Type safety with TypeScript generics
- ✅ Error handling
- ✅ Performance characteristics

## First Run

**Important**: The first test run will download the embedding model (~22MB) to `./.cache/transformers`. This is a one-time operation and subsequent runs will be much faster.

## Timeout Configuration

Tests that require model loading have a 60-second timeout. If you're on a slow connection, you may need to increase this in `jest.config.ts`:

```typescript
testTimeout: 120000, // 2 minutes
```

## Continuous Integration

For CI environments, consider:

1. **Caching the model**:

   ```yaml
   # GitHub Actions example
   - uses: actions/cache@v3
     with:
       path: .cache/transformers
       key: transformers-cache-${{ hashFiles('package.json') }}
   ```

2. **Pre-downloading the model**:
   ```bash
   # In CI setup script
   node -e "import('@huggingface/transformers').then(m => m.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'))"
   ```

## Writing New Tests

When adding new tests:

1. **Unit tests** (similarity utils): Add to `similarity.test.ts`
2. **Service tests** (embedding): Add to `embedding.test.ts`
3. **Integration tests** (full DB): Add to `vectoria.test.ts`

### Example Test

```typescript
describe('MyFeature', () => {
  let db: VectoriaDB;

  beforeAll(async () => {
    db = new VectoriaDB();
    await db.initialize();
  }, 60000);

  afterEach(() => {
    db.clear();
  });

  test('should do something', async () => {
    await db.add('id', 'text', { id: 'id' });
    const result = await db.search('query');
    expect(result).toBeDefined();
  });
});
```

## Debugging Tests

```bash
# Run with verbose output
nx test vectoria --verbose

# Run specific test by name
nx test vectoria -t "should add a document"

# Run in debug mode
node --inspect-brk ../../node_modules/.bin/jest --config=jest.config.ts
```

## Known Issues

1. **Model Download Failures**: If model download fails, delete `.cache/transformers` and try again
2. **Memory Issues**: Large test batches (>1000 documents) may need increased Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096`
