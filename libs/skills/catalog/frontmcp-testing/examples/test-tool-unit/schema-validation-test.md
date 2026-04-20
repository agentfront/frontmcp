---
name: schema-validation-test
reference: test-tool-unit
level: intermediate
description: "Validate that a tool's Zod input schema rejects invalid data before `execute()` is called."
tags: [testing, tool, unit, schema, validation]
features:
  - 'Testing the Zod input schema separately from the `execute()` method'
  - 'Using `safeParse()` to check validation results without throwing'
  - 'Covering rejection of wrong types, missing fields, and empty input'
  - 'Combining schema validation with execution to test the full flow'
---

# Testing Zod Schema Validation for Tool Input

Validate that a tool's Zod input schema rejects invalid data before `execute()` is called.

## Code

```typescript
// src/tools/__tests__/add.tool.schema.spec.ts
import { ToolContext, z } from '@frontmcp/sdk';

import { AddTool } from '../add.tool';

describe('AddTool schema validation', () => {
  const schema = z.object({ a: z.number(), b: z.number() });

  it('should accept valid numeric input', () => {
    const result = schema.safeParse({ a: 5, b: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ a: 5, b: 10 });
    }
  });

  it('should reject string values for numeric fields', () => {
    const result = schema.safeParse({ a: 'not-a-number', b: 3 });
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const result = schema.safeParse({ a: 5 });
    expect(result.success).toBe(false);
  });

  it('should reject empty input', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should coerce valid input and produce correct output', async () => {
    const tool = new AddTool();
    const ctx = {
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn((err) => {
        throw err;
      }),
      mark: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
    } as unknown as ToolContext;
    Object.assign(tool, ctx);

    const parsed = schema.parse({ a: 7, b: 3 });
    const result = await tool.execute(parsed);
    expect(result).toEqual({ sum: 10 });
  });
});
```

## What This Demonstrates

- Testing the Zod input schema separately from the `execute()` method
- Using `safeParse()` to check validation results without throwing
- Covering rejection of wrong types, missing fields, and empty input
- Combining schema validation with execution to test the full flow

## Related

- See `test-tool-unit` for the full tool unit testing reference
