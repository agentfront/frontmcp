# Standard Library Security Analysis

## Executive Summary

This document analyzes the security implications of whitelisting standard JavaScript library methods for use in sandboxed code execution (AgentScript). Each method is evaluated for:

- Known vulnerabilities (CVEs, attack vectors)
- Prototype pollution risks
- Denial of Service (DoS) risks
- Memory/CPU exhaustion risks
- Escape vectors (sandbox breakout)

**Classification:**

- ✅ **SAFE**: No known vulnerabilities, safe for untrusted code
- ⚠️ **SAFE WITH GUARDS**: Safe if runtime limits are enforced
- ❌ **NEVER WHITELIST**: Dangerous, enables attacks

---

## Math Object

### Analysis

The `Math` object contains pure mathematical functions with no side effects, no state, and no access to prototypes or global objects.

### Security Status: ✅ SAFE

All `Math` methods are safe:

- Pure functions (no side effects)
- No access to prototypes
- No access to global objects
- Cannot be used for timing attacks (constant time operations)
- Cannot cause memory issues (return primitives only)

### Recommended Whitelist

```javascript
Math: [
  // Rounding
  'floor',
  'ceil',
  'round',
  'trunc',

  // Min/Max
  'min',
  'max',

  // Absolute/Sign
  'abs',
  'sign',

  // Power/Root
  'pow',
  'sqrt',
  'cbrt',

  // Trigonometry (safe, pure functions)
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',

  // Logarithms
  'log',
  'log10',
  'log2',

  // Random (use with caution - see below)
  'random',

  // Constants
  'PI',
  'E',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
  'SQRT1_2',
  'SQRT2',
];
```

### Special Considerations

#### Math.random()

- ⚠️ **Potential timing leak**: Could theoretically be used to measure execution time
- ⚠️ **Not cryptographically secure**: Don't use for security-sensitive operations
- ✅ **Safe for AgentScript**: OK for data shuffling, sampling, etc.

---

## JSON Object

### Security Status: ⚠️ SAFE WITH GUARDS

### JSON.parse()

**Known Vulnerabilities:**

1. **Denial of Service (DoS) via Deep Nesting**

   - **Attack**: Deeply nested objects cause stack overflow

   ```javascript
   // DoS attack
   JSON.parse('{"a":{"a":{"a":{"a":{"a":{"a":...(1000 levels deep)...}}}}}}}');
   ```

   - **Impact**: Stack overflow, process crash
   - **Guard**: Implement maximum depth limit (default: 10 levels)

2. **Denial of Service (DoS) via Large Arrays**

   - **Attack**: Million-element arrays cause memory exhaustion

   ```javascript
   // DoS attack
   JSON.parse('[' + '1,'.repeat(10_000_000) + '1]');
   ```

   - **Impact**: Out of memory error
   - **Guard**: Implement maximum string length (default: 1MB)

3. **Prototype Pollution via `__proto__`**
   - **Attack**: Object with `__proto__` key pollutes prototype
   ```javascript
   JSON.parse('{"__proto__": {"isAdmin": true}}');
   ```
   - **Impact**: Can modify Object.prototype
   - **Guard**: Use `JSON.parse(str, reviver)` with `__proto__` filter

**Mitigation Strategy:**

```javascript
function safeJSONParse(str, maxDepth = 10, maxLength = 1_000_000) {
  if (str.length > maxLength) {
    throw new Error(`JSON string exceeds maximum length (${maxLength})`);
  }

  let depth = 0;
  return JSON.parse(str, (key, value) => {
    // Block __proto__ pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }

    // Check depth
    if (typeof value === 'object' && value !== null) {
      depth++;
      if (depth > maxDepth) {
        throw new Error(`JSON object exceeds maximum depth (${maxDepth})`);
      }
    }

    return value;
  });
}
```

### JSON.stringify()

**Known Vulnerabilities:**

1. **Denial of Service (DoS) via Circular References**

   - **Attack**: Circular object references cause infinite recursion

   ```javascript
   const obj = {};
   obj.self = obj;
   JSON.stringify(obj); // TypeError: Converting circular structure to JSON
   ```

   - **Impact**: Error but no crash (built-in protection)
   - **Guard**: Already handled by JSON.stringify (throws error)

2. **Denial of Service (DoS) via Large Objects**
   - **Attack**: Massive object payloads cause memory exhaustion
   ```javascript
   JSON.stringify({ data: new Array(10_000_000).fill('x') });
   ```
   - **Impact**: Memory exhaustion
   - **Guard**: Limit input object size

**Mitigation Strategy:**

```javascript
function safeJSONStringify(obj, maxSize = 100_000) {
  const str = JSON.stringify(obj);
  if (str.length > maxSize) {
    throw new Error(`JSON output exceeds maximum size (${maxSize})`);
  }
  return str;
}
```

### Recommendation: ⚠️ WHITELIST WITH GUARDS

```javascript
JSON: {
  parse: safeJSONParse,      // With depth/length limits
  stringify: safeJSONStringify, // With size limits
}
```

---

## Array Methods

### Security Status: ✅ SAFE / ⚠️ SAFE WITH GUARDS

### Iteration Methods (SAFE)

**✅ SAFE:**

- `map`, `filter`, `reduce`, `reduceRight`
- `forEach`, `some`, `every`
- `find`, `findIndex`, `findLast`, `findLastIndex`

**Why Safe:**

- Pure operations on array data
- Cannot access prototypes
- Cannot escape sandbox
- User-provided callbacks are already in sandbox

**Only Risk:** Performance

- Large arrays + complex callbacks = CPU time
- **Guard**: Limit array size (default: 100,000 elements)

### Mutation Methods (SAFE WITH CAUTION)

**⚠️ SAFE (but allow mutation):**

- `push`, `pop`, `shift`, `unshift`
- `splice`, `sort`, `reverse`
- `fill`, `copyWithin`

**Why Safe:**

- Only mutate the array itself
- Cannot access prototypes
- Cannot escape sandbox

**Consideration:**

- Do we want to allow mutation in AgentScript?
- **Recommendation**: For functional style, only whitelist non-mutating methods

### Access Methods (SAFE)

**✅ SAFE:**

- `slice`, `concat`, `flat`, `flatMap`
- `join`, `toString`, `toLocaleString`
- `indexOf`, `lastIndexOf`, `includes`
- `at`, `entries`, `keys`, `values`

**Why Safe:**

- Read-only operations
- Return new arrays or primitives
- Cannot modify prototypes

### ❌ NEVER WHITELIST

#### constructor

- Leads to Function constructor
- Enables arbitrary code execution

### Recommended Whitelist (Functional Style)

```javascript
Array.prototype: [
  // Iteration
  'map', 'filter', 'reduce', 'reduceRight',
  'forEach', 'some', 'every',
  'find', 'findIndex', 'findLast', 'findLastIndex',

  // Access
  'slice', 'concat', 'flat', 'flatMap',
  'join', 'indexOf', 'lastIndexOf', 'includes',
  'at', 'entries', 'keys', 'values',

  // Metadata
  'length',
]
```

---

## Object Methods

### Security Status: ✅ SAFE / ❌ DANGEROUS

### Safe Methods

**✅ SAFE:**

- `Object.keys(obj)` - Returns array of property names
- `Object.values(obj)` - Returns array of property values
- `Object.entries(obj)` - Returns array of [key, value] pairs
- `Object.assign(target, ...sources)` - Shallow copy properties
- `Object.freeze(obj)` - Makes object immutable
- `Object.seal(obj)` - Prevents adding/removing properties
- `Object.is(a, b)` - Comparison (same as ===)

**Why Safe:**

- Read-only operations or controlled mutations
- Cannot access prototypes in dangerous ways
- Cannot escape sandbox

### Dangerous Methods - ❌ NEVER WHITELIST

#### Object.getPrototypeOf(obj)

- **Risk**: Access prototype chain
- **Attack**: `Object.getPrototypeOf({}).constructor.constructor('return process')()`
- **Blocked by**: NoGlobalAccessRule (already blocks this)

#### Object.setPrototypeOf(obj, proto)

- **Risk**: Prototype pollution
- **Attack**: `Object.setPrototypeOf(obj, Function.prototype); obj('return process')()`
- **Blocked by**: NoGlobalAccessRule (already blocks this)

#### Object.getOwnPropertyDescriptor(obj, prop)

- **Risk**: Extract function references from property descriptors
- **Attack**: `Object.getOwnPropertyDescriptor(window, 'eval').value('code')`
- **Blocked by**: NoGlobalAccessRule (already blocks this)

#### Object.getOwnPropertyDescriptors(obj)

- **Risk**: Same as getOwnPropertyDescriptor
- **Blocked by**: NoGlobalAccessRule

#### Object.defineProperty(obj, prop, descriptor)

- **Risk**: Can modify property descriptors, potentially bypassing protections
- **Attack**: Make read-only properties writable

#### Object.create(proto)

- **Risk**: Create objects with arbitrary prototypes
- **Attack**: `Object.create(Function.prototype)`

### Object.assign() Special Considerations

**⚠️ Prototype Pollution Risk:**

```javascript
const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
Object.assign({}, malicious); // Pollutes Object.prototype
```

**Mitigation:**

```javascript
function safeObjectAssign(target, ...sources) {
  for (const source of sources) {
    if (source === null || source === undefined) continue;

    for (const key of Object.keys(source)) {
      // Block prototype pollution keys
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      target[key] = source[key];
    }
  }
  return target;
}
```

### Recommended Whitelist

```javascript
Object: {
  keys: Object.keys,
  values: Object.values,
  entries: Object.entries,
  assign: safeObjectAssign, // With __proto__ filter
  freeze: Object.freeze,
  seal: Object.seal,
  is: Object.is,
}
```

---

## String Methods

### Security Status: ✅ SAFE

String methods are generally very safe:

- Strings are immutable primitives
- Methods return new strings
- No side effects
- No prototype access risks

### All Safe Methods

**✅ SAFE:**

```javascript
String.prototype: [
  // Search
  'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith',
  'search', 'match', 'matchAll',

  // Extract
  'slice', 'substring', 'substr', 'charAt', 'charCodeAt', 'at',

  // Transform
  'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase',
  'trim', 'trimStart', 'trimEnd', 'trimLeft', 'trimRight',
  'repeat', 'padStart', 'padEnd',
  'replace', 'replaceAll',

  // Split/Join
  'split', 'concat',

  // Format
  'toString', 'valueOf',

  // Metadata
  'length',
]
```

### ❌ NEVER WHITELIST

#### constructor

- Leads to String → Function constructor chain
- **Attack**: `"".constructor.constructor('return process')()`

### Special Considerations

#### String.prototype.replace() with function callback

- ✅ Safe: Callback is already sandboxed
- User code can't escape via replace callback

#### RegExp usage in string methods

- ⚠️ **Potential ReDoS (Regular Expression DoS)**
- **Attack**: `"a".repeat(100_000).match(/a(a+)+b/)`
- **Guard**: Limit string length, timeout on regex operations

### Recommended Whitelist

```javascript
// All string methods are safe (except constructor)
String.prototype: [
  'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith',
  'slice', 'substring', 'toLowerCase', 'toUpperCase',
  'trim', 'split', 'replace', 'replaceAll',
  'length', // property
]
```

---

## Date Object

### Security Status: ⚠️ SAFE WITH CONSIDERATIONS

### Safe Methods

**✅ SAFE:**

- `Date.now()` - Returns current timestamp (milliseconds)
- `new Date()` - Create date object
- `date.getTime()` - Get timestamp from date
- `date.getFullYear()`, `getMonth()`, `getDate()` - Read date components
- `date.toISOString()` - Format as ISO string

**Why Safe:**

- Read-only time operations
- Cannot modify system time
- Cannot escape sandbox

### Timing Attack Considerations

**⚠️ Potential Timing Information Leak:**

- `Date.now()` reveals current time
- Could theoretically be used to measure execution time
- Could potentially detect other processes via timing

**Is this a real risk?**

- For AgentScript (data manipulation): **low-risk**
- Date/time operations are commonly needed for filtering data
- Sandbox is already isolated from sensitive operations

**Mitigation:**

- Accept this as acceptable risk for AgentScript
- Monitor for unusual Date.now() patterns in production

### ❌ NEVER WHITELIST

#### constructor property

- Same as all objects: leads to Function constructor

### Recommended Whitelist

```javascript
Date: {
  now: Date.now,
  // Constructor is provided as __safe_Date in runtime
}

Date.prototype: [
  'getTime', 'getFullYear', 'getMonth', 'getDate',
  'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds',
  'toISOString', 'toJSON', 'toString',
]
```

---

## Constructor Chain Attacks

### The Core Vulnerability

All objects in JavaScript have a `constructor` property that references their constructor function. Constructor functions themselves have a `constructor` property that references `Function`. The `Function` constructor can execute arbitrary code.

### Attack Chain Example

```javascript
// ANY object can lead to Function constructor
[].constructor              // Array
  .constructor              // Function
  ('return process')()      // Execute arbitrary code
  .exit()                   // Exit process

// Works with all primitives/objects
"".constructor.constructor('return process')()
(1).constructor.constructor('return process')()
true.constructor.constructor('return process')()
({}).constructor.constructor('return process')()
/a/.constructor.constructor('return process')()
Math.constructor.constructor('return process')()
```

### Protection Strategy

**Already Implemented:**

- `NoGlobalAccessRule` blocks ALL `.constructor` access
- This rule is in the STRICT preset
- Catches constructor access at AST level

**Verification:**

```javascript
const code = `[].constructor.constructor('return process')()`;
// ❌ BLOCKED: NO_CONSTRUCTOR_ACCESS
```

### Why This is Critical

Without blocking `.constructor`:

- Even "safe" objects (Math, Array, String) become dangerous
- Whitelist becomes useless (attacker can reach Function via any object)
- Sandbox escapes are trivial

**Conclusion:**

- ✅ `.constructor` blocking is MANDATORY
- ✅ Already implemented in NoGlobalAccessRule
- ✅ Must remain active in AgentScript preset

---

## Prototype Pollution Attacks

### What is Prototype Pollution?

Modifying the prototype of built-in objects (Object, Array, etc.) to add or change properties that affect all objects of that type.

### Attack Vectors

#### 1. Object.setPrototypeOf()

```javascript
Object.setPrototypeOf({}, Function.prototype);
// Now {} is callable as a function
```

**Status:** ❌ Blocked by NoGlobalAccessRule

#### 2. `__proto__` property

```javascript
const obj = {};
obj.__proto__.polluted = true;
({}).polluted; // true (all objects now have this property)
```

**Status:** ❌ Blocked by DisallowedIdentifierRule

#### 3. Object.defineProperty()

```javascript
Object.defineProperty(Object.prototype, 'polluted', {
  value: true,
});
```

**Status:** ❌ Blocked by not whitelisting defineProperty

#### 4. JSON.parse() with `__proto__`

```javascript
JSON.parse('{"__proto__": {"polluted": true}}');
({}).polluted; // true
```

**Status:** ⚠️ Need to filter `__proto__` in safe JSON.parse

### Protection Strategy

1. **Block dangerous Object methods** (already done)
2. **Block `__proto__` access** (already done in STRICT preset)
3. **Filter `__proto__` in JSON.parse** (to be implemented)
4. **Implement `__proto__` filtering in Object.assign** (future enhancement)
5. **Optionally freeze prototypes in sandbox** (additional hardening)

---

## Summary: Recommended Whitelist

### ✅ SAFE - Whitelist All Methods

#### Math

- All methods safe (pure functions)

#### String

- All methods safe (immutable operations)

### ⚠️ SAFE WITH GUARDS - Whitelist with Protections

#### JSON

- parse: Add depth/length limits, filter `__proto__`
- stringify: Add size limits

#### Array

- Iteration methods: Add array size limits
- Access methods: All safe

#### Object

- keys, values, entries: Safe
- assign: Filter `__proto__`, constructor, prototype keys
- freeze, seal, is: Safe

#### Date

- now: Safe (acceptable timing leak)
- Constructor: Safe
- Read methods: Safe

### ❌ NEVER WHITELIST - Always Dangerous

#### ANY object

- .constructor property (leads to Function constructor)

#### Object

- getPrototypeOf, setPrototypeOf (prototype manipulation)
- getOwnPropertyDescriptor, getOwnPropertyDescriptors (property inspection)
- defineProperty, defineProperties (property manipulation)
- create (arbitrary prototype creation)

#### Reflect

- ALL methods (Reflect.get, Reflect.apply, etc.)

---

## Runtime Limits

### Recommended Limits for AgentScript

> **Note:** Currently enforced limits are marked with ✅. Other limits are recommended
> values for future implementation or application-level enforcement.

```javascript
const AGENTSCRIPT_LIMITS = {
  // ⚠️ JSON (NOT enforced - application-level enforcement required)
  maxJSONStringLength: 1_000_000, // 1MB max JSON string
  maxJSONDepth: 10, // 10 levels deep max
  maxJSONOutputSize: 100_000, // 100KB max output

  // ⚠️ Arrays (NOT enforced - application-level enforcement required)
  maxArraySize: 100_000, // 100K elements max
  maxArrayMemory: 10_000_000, // 10MB max array memory

  // ⚠️ Strings (NOT enforced - application-level enforcement required)
  maxStringLength: 1_000_000, // 1MB max string

  // ⚠️ Objects (NOT enforced - application-level enforcement required)
  maxObjectKeys: 10_000, // 10K keys max
  maxObjectDepth: 10, // 10 levels deep max

  // ✅ Iteration (enforced by Enclave safe runtime)
  maxIterations: 10_000, // 10K iterations max (for loops)

  // ✅ Execution (enforced by Enclave)
  maxExecutionTime: 30_000, // 30 seconds max
  maxMemory: 128_000_000, // 128MB max (VM timeout on large allocations)
};
```

---

## References

### CVEs

- CVE-2019-11358: jQuery prototype pollution via $.extend
- CVE-2021-23337: Lodash prototype pollution
- CVE-2023-29017: vm2 prototype pollution

### Research Papers

- "Prototype Pollution: The Dangerous and Underrated Vulnerability Impacting JavaScript Applications" (2019)
- "JSON Interoperability Vulnerability" (OWASP)
- "ReDoS (Regular Expression Denial of Service) Attacks" (OWASP)

### Standards

- OWASP Top 10
- CWE-1321: Improperly Controlled Modification of Object Prototype Attributes
- CWE-400: Uncontrolled Resource Consumption

---

_Last Updated: 2025-11-24_
_Version: 1.0.0_
_Status: COMPREHENSIVE SECURITY ANALYSIS_
