# Loop Transformation Design

## Overview

This document describes the design for transforming loop constructs (`for`, `while`, `do-while`) into safe function calls that allow resource-limited execution.

## Current Approach vs. Proposed Approach

### Current (Blocking)

```javascript
// User code
for (let i = 0; i < 10; i++) {
  console.log(i);
}

// Result: ❌ BLOCKED by validation
```

### Proposed (Transformation)

```javascript
// User code
for (let i = 0; i < 10; i++) {
  console.log(i);
}

// Transformed to:
__safe_for(
  () => {
    let i = 0;
    return i;
  }, // init
  (i) => i < 10, // test
  (i) => {
    i++;
    return i;
  }, // update
  (i) => {
    console.log(i);
  }, // body
);
```

## Benefits

1. **Resource Limits**: Runtime can enforce iteration limits
2. **Timeouts**: Can timeout long-running loops
3. **Monitoring**: Track loop execution for debugging
4. **Break/Continue**: Can be emulated with return values
5. **User Experience**: Allows loops instead of blocking them

## Implementation Strategy

### Phase 1: Simple For Loops

Transform basic `for` loops with simple init/test/update:

```javascript
// AST Structure
{
  type: 'ForStatement',
  init: { type: 'VariableDeclaration', ... },
  test: { type: 'BinaryExpression', ... },
  update: { type: 'UpdateExpression', ... },
  body: { type: 'BlockStatement', ... }
}

// Transform to:
{
  type: 'ExpressionStatement',
  expression: {
    type: 'CallExpression',
    callee: { type: 'Identifier', name: '__safe_for' },
    arguments: [
      { type: 'ArrowFunctionExpression', ... }, // init
      { type: 'ArrowFunctionExpression', ... }, // test
      { type: 'ArrowFunctionExpression', ... }, // update
      { type: 'ArrowFunctionExpression', ... }  // body
    ]
  }
}
```

### Phase 2: While Loops

```javascript
// Original
while (condition) {
  body;
}

// Transformed
__safe_while(
  () => condition, // test
  () => {
    body;
  }, // body
);
```

### Phase 3: Do-While Loops

```javascript
// Original
do {
  body;
} while (condition);

// Transformed
__safe_doWhile(
  () => {
    body;
  }, // body (executes first)
  () => condition, // test
);
```

### Phase 4: Break/Continue Handling

Use special return values to signal break/continue:

```javascript
// Original
for (let i = 0; i < 10; i++) {
  if (i === 5) break;
  if (i % 2 === 0) continue;
  console.log(i);
}

// Transformed
__safe_for(
  () => {
    let i = 0;
    return i;
  },
  (i) => i < 10,
  (i) => {
    i++;
    return i;
  },
  (i) => {
    if (i === 5) return { type: 'break' };
    if (i % 2 === 0) return { type: 'continue' };
    console.log(i);
    return { type: 'normal' };
  },
);
```

### Phase 5: For-In/For-Of Loops

```javascript
// For-in
for (const key in obj) {
  body;
}

// Transformed
__safe_forIn(
  () => obj, // object to iterate
  (key) => {
    body;
  }, // body with key
);

// For-of
for (const item of array) {
  body;
}

// Transformed
__safe_forOf(
  () => array, // iterable
  (item) => {
    body;
  }, // body with item
);
```

## Runtime Implementation

The `__safe_*` functions would be provided by the sandbox worker:

```typescript
function __safe_for(
  init: () => any,
  test: (state: any) => boolean,
  update: (state: any) => any,
  body: (state: any) => { type: string },
): void {
  const MAX_ITERATIONS = 10000; // Configurable limit
  const START_TIME = Date.now();
  const MAX_TIME_MS = 5000; // 5 second timeout

  let state = init();
  let iterations = 0;

  while (test(state)) {
    // Check iteration limit
    if (++iterations > MAX_ITERATIONS) {
      throw new Error(`Loop exceeded maximum iterations (${MAX_ITERATIONS})`);
    }

    // Check timeout
    if (Date.now() - START_TIME > MAX_TIME_MS) {
      throw new Error(`Loop exceeded maximum time (${MAX_TIME_MS}ms)`);
    }

    // Execute body
    const result = body(state);

    // Handle break/continue
    if (result?.type === 'break') {
      break;
    }
    if (result?.type === 'continue') {
      state = update(state);
      continue;
    }

    // Update state
    state = update(state);
  }
}

function __safe_while(test: () => boolean, body: () => { type: string }): void {
  const MAX_ITERATIONS = 10000;
  const START_TIME = Date.now();
  const MAX_TIME_MS = 5000;

  let iterations = 0;

  while (test()) {
    if (++iterations > MAX_ITERATIONS) {
      throw new Error(`Loop exceeded maximum iterations (${MAX_ITERATIONS})`);
    }

    if (Date.now() - START_TIME > MAX_TIME_MS) {
      throw new Error(`Loop exceeded maximum time (${MAX_TIME_MS}ms)`);
    }

    const result = body();
    if (result?.type === 'break') break;
  }
}

function __safe_forOf(getIterable: () => Iterable<any>, body: (item: any) => { type: string }): void {
  const MAX_ITERATIONS = 10000;
  const START_TIME = Date.now();
  const MAX_TIME_MS = 5000;

  let iterations = 0;
  const iterable = getIterable();

  for (const item of iterable) {
    if (++iterations > MAX_ITERATIONS) {
      throw new Error(`Loop exceeded maximum iterations (${MAX_ITERATIONS})`);
    }

    if (Date.now() - START_TIME > MAX_TIME_MS) {
      throw new Error(`Loop exceeded maximum time (${MAX_TIME_MS}ms)`);
    }

    const result = body(item);
    if (result?.type === 'break') break;
    if (result?.type === 'continue') continue;
  }
}
```

## Challenges and Solutions

### Challenge 1: Variable Scope

**Problem**: Loop variables need to be accessible in transformed functions.

**Solution**: Use closures to capture loop variables:

```javascript
// Original
for (let i = 0; i < 10; i++) {
  setTimeout(() => console.log(i), 100);
}

// Needs careful closure handling in transformation
```

### Challenge 2: Nested Loops

**Problem**: Break/continue should only affect the nearest loop.

**Solution**: Use labeled breaks or stack-based control flow:

```javascript
outer: for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    if (condition) break outer;
  }
}

// Transform with labels
__safe_for_labeled('outer', ...)
```

### Challenge 3: Performance

**Problem**: Function calls add overhead compared to native loops.

**Solution**:

- Use efficient runtime implementation
- Cache test/update functions
- Optimize for common patterns
- Profile and benchmark

### Challenge 4: Complex Loop Bodies

**Problem**: Loop bodies may reference outer scope variables.

**Solution**: Analyze variable usage and pass as parameters:

```javascript
const max = 100;
for (let i = 0; i < max; i++) {
  // Uses 'max' from outer scope
}

// Transform with closure
__safe_for(
  () => ({ i: 0, max }), // Capture outer variables
  (state) => state.i < state.max,
  (state) => ({ ...state, i: state.i + 1 }),
  (state) => {
    /* body uses state.i, state.max */
  },
);
```

## Implementation Roadmap

### Phase 1: Foundation (Milestone 1)

- ✅ Add `transformLoops` config option
- ⬜ Implement basic `for` loop transformation
- ⬜ Add runtime `__safe_for` implementation
- ⬜ Write comprehensive tests

### Phase 2: Loop Variants (Milestone 2)

- ⬜ Implement `while` loop transformation
- ⬜ Implement `do-while` loop transformation
- ⬜ Add runtime implementations
- ⬜ Test break/continue handling

### Phase 3: Advanced Features (Milestone 3)

- ⬜ Implement `for-in` transformation
- ⬜ Implement `for-of` transformation
- ⬜ Handle labeled breaks
- ⬜ Optimize performance

### Phase 4: Production Hardening (Milestone 4)

- ⬜ Add comprehensive security tests
- ⬜ Performance benchmarks
- ⬜ Edge case handling
- ⬜ Documentation and examples

## Testing Strategy

### Unit Tests

```typescript
describe('Loop Transformation', () => {
  it('should transform simple for loop', async () => {
    const code = 'for (let i = 0; i < 10; i++) { console.log(i); }';
    const result = await validator.validate(code, {
      transform: { enabled: true, transformLoops: true },
    });

    expect(result.transformedCode).toContain('__safe_for');
    expect(result.transformedCode).not.toContain('for (');
  });

  it('should preserve loop semantics', async () => {
    // Execute transformed code and verify output matches original
  });

  it('should enforce iteration limits', async () => {
    const code = 'for (let i = 0; i < 1000000; i++) { }';
    await expect(executeCode(code)).rejects.toThrow('exceeded maximum iterations');
  });
});
```

### Integration Tests

- Test with real CodeCall execution
- Verify resource limits work
- Test break/continue behavior
- Test nested loops
- Test error handling

### Security Tests

- Attempt to bypass iteration limits
- Test infinite loop prevention
- Verify timeout enforcement
- Test with malicious inputs

## Conclusion

Loop transformation is a powerful security enhancement that:

1. Allows controlled execution of loops
2. Prevents infinite loops and resource exhaustion
3. Provides better user experience than blocking
4. Enables monitoring and debugging

The implementation should be done incrementally with thorough testing at each phase.
