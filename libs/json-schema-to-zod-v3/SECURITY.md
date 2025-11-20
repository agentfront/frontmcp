# Security Considerations

## Overview

This document describes security considerations when using `json-schema-to-zod-v3`, particularly around handling
untrusted JSON Schema input.

## ⚠️ Critical: ReDoS (Regular Expression Denial of Service)

### The Risk

JSON Schema `pattern` constraints use regular expressions. **Malicious or pathological regex patterns can cause ReDoS
attacks**, leading to:

- Performance degradation
- Application hangs
- Denial of service

### Example of Dangerous Pattern

```json
{
  "type": "string",
  "pattern": "(a+)+"
}
```

This pattern can cause exponential backtracking, making the regex engine hang on inputs like
`"aaaaaaaaaaaaaaaaaaaaaaaX"`.

## 🛡️ Built-in Protection

Starting from v1.0.0, this library includes **automatic ReDoS protection** for all `pattern` constraints:

### What's Protected

1. **Pattern Validation**: Checks for known dangerous constructs
2. **Length Limits**: Rejects patterns longer than 1,000 characters
3. **Quantifier Limits**: Rejects quantifiers larger than {100}
4. **Timeout Protection**: Regex operations timeout after 100 ms
5. **Runtime Testing**: Tests patterns before use

### How It Works

```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

// Dangerous pattern is automatically detected and rejected
const schema = {
  type: 'string',
  pattern: '(a+)+', // ReDoS pattern
};

const zodSchema = convertJsonSchemaToZod(schema);
// Pattern is rejected, warning logged to console
// Validation will always fail for safety
```

### Configuration

You can customize protection behavior:

```typescript
import { setSecurityConfig } from 'json-schema-to-zod-v3';

// Adjust protection settings
setSecurityConfig({
  enableProtection: true, // Enable/disable protection
  warnOnUnsafe: true, // Log warnings for unsafe patterns
  throwOnUnsafe: false, // Throw errors instead of warnings
  maxPatternLength: 1000, // Maximum pattern length
  maxQuantifier: 100, // Maximum quantifier value
  timeoutMs: 100, // Regex operation timeout
});
```

### Manual Validation

For more control, use the security utilities directly:

```typescript
import { validatePattern, createSafeRegExp, createSafePatternValidator } from 'json-schema-to-zod-v3';

// Validate a pattern before use
const result = validatePattern('^[a-z]+$');
if (result.safe) {
  console.log('Pattern is safe to use');
} else {
  console.error('Unsafe pattern:', result.reason);
}

// Create a safe regex with timeout protection
const regex = createSafeRegExp('^[a-z]+$');
if (regex) {
  const isValid = regex.test(input);
}

// Create a safe validator function
const validator = createSafePatternValidator('^[a-z]+$');
const schema = z.string().refine(validator, 'Must match pattern');
```

## 📊 Trusted vs Untrusted Input

### Trusted Input Sources

Safe to use with default settings:

- ✅ JSON Schemas you control and maintain
- ✅ Schemas from your backend/database
- ✅ Schemas from trusted third parties
- ✅ OpenAPI specifications from known APIs

### Untrusted Input Sources

**Requires extra caution:**

- ⚠️ User-uploaded JSON Schemas
- ⚠️ Schemas from public APIs
- ⚠️ Schemas from external sources
- ⚠️ Dynamically generated schemas from user input

**Recommendation for untrusted input:**

1. Keep ReDoS protection enabled (default)
2. Consider setting `throwOnUnsafe: true` to fail fast
3. Implement additional input validation
4. Use a whitelist of allowed patterns if possible
5. Rate limit schema conversions

## 🔒 Security Best Practices

### 1. Never Disable Protection for Untrusted Input

```typescript
// ❌ DANGEROUS with untrusted input
setSecurityConfig({ enableProtection: false });

// ✅ SAFE - keep protection enabled
setSecurityConfig({ enableProtection: true });
```

### 2. Validate Schemas Before Conversion

```typescript
import { validatePattern } from 'json-schema-to-zod-v3';

function convertUntrustedSchema(schema: any) {
  // Validate patterns first
  if (schema.pattern) {
    const result = validatePattern(schema.pattern);
    if (!result.safe) {
      throw new Error(`Unsafe pattern: ${result.reason}`);
    }
  }

  // Validate nested patterns
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (typeof prop === 'object' && prop.pattern) {
        const result = validatePattern(prop.pattern);
        if (!result.safe) {
          throw new Error(`Unsafe pattern in property: ${result.reason}`);
        }
      }
    }
  }

  return convertJsonSchemaToZod(schema);
}
```

### 3. Use Timeouts for Schema Conversion

```typescript
function convertWithTimeout(schema: any, timeoutMs: number = 5000) {
  return Promise.race([
    Promise.resolve(convertJsonSchemaToZod(schema)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Conversion timeout')), timeoutMs)),
  ]);
}

// Usage
try {
  const zodSchema = await convertWithTimeout(untrustedSchema);
} catch (error) {
  console.error('Schema conversion failed or timed out:', error);
}
```

### 4. Sanitize User Input

```typescript
function sanitizeSchema(schema: any): any {
  // Remove dangerous fields
  const {
    pattern, // Remove pattern from untrusted input
    ...safe
  } = schema;

  // Recursively sanitize properties
  if (safe.properties) {
    safe.properties = Object.fromEntries(
      Object.entries(safe.properties).map(([key, value]) => [key, sanitizeSchema(value)]),
    );
  }

  return safe;
}
```

### 5. Rate Limiting

For public APIs accepting schemas:

```typescript
import rateLimit from 'express-rate-limit';

const schemaConversionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many schema conversions, please try again later',
});

app.post('/api/convert-schema', schemaConversionLimiter, (req, res) => {
  try {
    const zodSchema = convertJsonSchemaToZod(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Invalid schema' });
  }
});
```

## 📋 Known Limitations

### What's Protected

- ✅ `pattern` constraints (with ReDoS protection)
- ✅ Nested patterns in objects and arrays
- ✅ Patterns in composition keywords (allOf, anyOf, etc.)

### What's Not Protected

- ⚠️ Deeply nested schemas (may cause stack overflow)
- ⚠️ Extremely large schemas (may cause memory issues)
- ⚠️ Circular references (not detected, will cause infinite loops)

### Recommendations

For untrusted input, implement additional checks:

```typescript
function validateSchemaStructure(schema: any, depth = 0): void {
  const MAX_DEPTH = 20;
  const MAX_PROPERTIES = 100;

  if (depth > MAX_DEPTH) {
    throw new Error('Schema too deeply nested');
  }

  if (schema.properties && Object.keys(schema.properties).length > MAX_PROPERTIES) {
    throw new Error('Too many properties');
  }

  // Recursively validate nested schemas
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (typeof prop === 'object') {
        validateSchemaStructure(prop, depth + 1);
      }
    }
  }

  // Check composition keywords
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) {
      for (const subSchema of schema[key]) {
        validateSchemaStructure(subSchema, depth + 1);
      }
    }
  }
}
```

## 🔍 Detecting Attacks

Monitor for suspicious patterns:

```typescript
import { validatePattern } from 'json-schema-to-zod-v3';

function logSchemaConversion(schema: any, userId: string) {
  let suspiciousPatterns = 0;

  function checkPatterns(obj: any) {
    if (obj.pattern) {
      const result = validatePattern(obj.pattern);
      if (!result.safe) {
        suspiciousPatterns++;
        console.warn(`[SECURITY] User ${userId} submitted unsafe pattern: ${result.reason}`);
      }
    }

    // Check nested objects
    if (obj.properties) {
      for (const prop of Object.values(obj.properties)) {
        if (typeof prop === 'object') {
          checkPatterns(prop);
        }
      }
    }
  }

  checkPatterns(schema);

  if (suspiciousPatterns > 3) {
    console.error(`[SECURITY] User ${userId} submitted ${suspiciousPatterns} unsafe patterns - possible attack`);
    // Consider blocking the user or triggering an alert
  }
}
```

## 📚 Additional Resources

- [OWASP: Regular Expression Denial of Service](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
- [Snyk: ReDoS Prevention](https://snyk.io/blog/redos-and-catastrophic-backtracking/)
- [Safe Regex](https://github.com/substack/safe-regex) - Tool for detecting unsafe regexes

## ⚡ Quick Reference

| Scenario              | Recommendation                                      |
|-----------------------|-----------------------------------------------------|
| **Trusted schemas**   | Use default settings                                |
| **Untrusted schemas** | Keep protection enabled, validate first             |
| **Public API**        | Enable protection + rate limiting + validation      |
| **User upload**       | Sanitize input, reject patterns, validate structure |
| **Production**        | Monitor suspicious patterns, log warnings           |

## 🆘 Reporting Security Issues

If you discover a security vulnerability, please email <david@frontegg.com> instead of using the issue tracker.

---

**TL;DR**: ReDoS protection is **enabled by default**. For untrusted input, keep it enabled and consider additional
validation. The library is safe for production use with default settings.
