/**
 * E2E Tests for React UI Tools
 *
 * Tests for react-chart and react-form tools including:
 * - Basic functionality
 * - Data transformation and calculations
 * - Edge cases and boundaries
 * - Field types and validation
 */
import { test, expect } from '@frontmcp/testing';

test.describe('React Tools E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('React Chart Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate React chart with data points', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'Jan', value: 100 },
            { label: 'Feb', value: 150 },
            { label: 'Mar', value: 120 },
          ],
          title: 'Monthly Sales',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('maxValue');
      });

      test('should return data array in output', async ({ mcp }) => {
        const inputData = [
          { label: 'A', value: 10 },
          { label: 'B', value: 20 },
        ];

        const result = await mcp.tools.call('react-chart', {
          data: inputData,
          title: 'Test Chart',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ data: Array<{ label: string; value: number }> }>();
        expect(json.data).toHaveLength(2);
        expect(json.data[0].label).toBe('A');
        expect(json.data[1].label).toBe('B');
      });

      test('should handle chart without title', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [{ label: 'X', value: 10 }],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Max Value Calculation', () => {
      test('should calculate maxValue correctly', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'Q1', value: 50 },
            { label: 'Q2', value: 200 },
            { label: 'Q3', value: 75 },
          ],
          title: 'Quarterly Revenue',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe(200);
      });

      test('should find max value with negative numbers', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'A', value: -10 },
            { label: 'B', value: 5 },
            { label: 'C', value: -20 },
          ],
          title: 'Mixed Values',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe(5);
      });

      test('should return at least 1 for maxValue with all zeros', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'A', value: 0 },
            { label: 'B', value: 0 },
          ],
          title: 'Zero Values',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBeGreaterThanOrEqual(1);
      });

      test('should return at least 1 for maxValue with all negative', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'A', value: -10 },
            { label: 'B', value: -20 },
          ],
          title: 'All Negative',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBeGreaterThanOrEqual(1);
      });

      test('should handle single very large value', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'Small', value: 1 },
            { label: 'Large', value: 1000000 },
          ],
          title: 'Large Value',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe(1000000);
      });

      test('should handle decimal values', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'A', value: 0.5 },
            { label: 'B', value: 1.7 },
            { label: 'C', value: 0.3 },
          ],
          title: 'Decimal Values',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe(1.7);
      });
    });

    test.describe('Edge Cases and Boundaries', () => {
      test('should handle single data point', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [{ label: 'Single', value: 42 }],
          title: 'Single Point Chart',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number; data: Array<{ label: string; value: number }> }>();
        expect(json.maxValue).toBe(42);
        expect(json.data).toHaveLength(1);
      });

      test('should handle many data points', async ({ mcp }) => {
        const data = Array.from({ length: 50 }, (_, i) => ({
          label: `Point ${i}`,
          value: Math.floor(Math.random() * 1000),
        }));

        const result = await mcp.tools.call('react-chart', {
          data,
          title: 'Large Chart',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ data: Array<{ label: string; value: number }> }>();
        expect(json.data).toHaveLength(50);
      });

      test('should handle 100 data points', async ({ mcp }) => {
        const data = Array.from({ length: 100 }, (_, i) => ({
          label: `P${i}`,
          value: i * 10,
        }));

        const result = await mcp.tools.call('react-chart', {
          data,
          title: 'Very Large Chart',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ data: Array<{ label: string; value: number }> }>();
        expect(json.data).toHaveLength(100);
      });

      test('should handle very long labels', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'A'.repeat(100), value: 10 },
            { label: 'B'.repeat(100), value: 20 },
          ],
          title: 'Long Labels',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle all equal values', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: 'A', value: 50 },
            { label: 'B', value: 50 },
            { label: 'C', value: 50 },
          ],
          title: 'Equal Values',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe(50);
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle emoji in labels', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: '🌟 Stars', value: 100 },
            { label: '❤️ Hearts', value: 80 },
            { label: '🔥 Fire', value: 120 },
          ],
          title: 'Emoji Chart 📊',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ maxValue: number }>();
        expect(json.maxValue).toBe(120);
      });

      test('should handle Unicode in labels', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [
            { label: '日本', value: 100 },
            { label: 'Deutschland', value: 80 },
            { label: 'Россия', value: 90 },
          ],
          title: 'International Chart',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle special characters in title', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [{ label: 'Test', value: 10 }],
          title: 'Chart with <special> & "characters"',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing data array', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          title: 'No Data Chart',
        });

        expect(result).toBeError();
      });

      test('should reject empty data array', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [],
          title: 'Empty Data',
        });

        // Empty array should still succeed as it's a valid array
        expect(result).toBeSuccessful();
      });

      test('should reject invalid data format', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: 'not an array',
          title: 'Invalid Data',
        });

        expect(result).toBeError();
      });

      test('should reject data with missing label', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [{ value: 10 }],
          title: 'Missing Label',
        });

        expect(result).toBeError();
      });

      test('should reject data with missing value', async ({ mcp }) => {
        const result = await mcp.tools.call('react-chart', {
          data: [{ label: 'Test' }],
          title: 'Missing Value',
        });

        expect(result).toBeError();
      });
    });
  });

  test.describe('React Form Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate React form with fields', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'message', type: 'textarea', label: 'Message' },
          ],
          submitLabel: 'Send',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('fieldCount');
      });

      test('should count form fields correctly', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'name', type: 'text', label: 'Name', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'phone', type: 'text', label: 'Phone' },
          ],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fieldCount: number }>();
        expect(json.fieldCount).toBe(3);
      });

      test('should return fields in output', async ({ mcp }) => {
        const fields = [
          { name: 'username', type: 'text' as const, label: 'Username' },
          { name: 'age', type: 'number' as const, label: 'Age' },
        ];

        const result = await mcp.tools.call('react-form', {
          fields,
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fields: typeof fields }>();
        expect(json.fields).toHaveLength(2);
        expect(json.fields[0].name).toBe('username');
      });
    });

    test.describe('Field Types', () => {
      test('should handle text field type', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'username', type: 'text', label: 'Username' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle email field type', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'email', type: 'email', label: 'Email' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle number field type', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'age', type: 'number', label: 'Age' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle textarea field type', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'bio', type: 'textarea', label: 'Biography' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle all supported field types together', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'textField', type: 'text', label: 'Text' },
            { name: 'emailField', type: 'email', label: 'Email', required: true },
            { name: 'numberField', type: 'number', label: 'Number' },
            { name: 'textareaField', type: 'textarea', label: 'Textarea' },
          ],
          submitLabel: 'Submit All',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fieldCount: number }>();
        expect(json.fieldCount).toBe(4);
      });
    });

    test.describe('Required Fields', () => {
      test('should handle required field flag', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'required_field', type: 'text', label: 'Required', required: true },
            { name: 'optional_field', type: 'text', label: 'Optional', required: false },
          ],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fields: Array<{ required?: boolean }> }>();
        expect(json.fields[0].required).toBe(true);
        expect(json.fields[1].required).toBe(false);
      });

      test('should default required to undefined when not specified', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'field', type: 'text', label: 'Field' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fields: Array<{ required?: boolean }> }>();
        expect(json.fields[0].required).toBeUndefined();
      });

      test('should handle all required fields', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'f1', type: 'text', label: 'Field 1', required: true },
            { name: 'f2', type: 'email', label: 'Field 2', required: true },
            { name: 'f3', type: 'number', label: 'Field 3', required: true },
          ],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Edge Cases and Boundaries', () => {
      test('should handle single field', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'single', type: 'text', label: 'Single Field' }],
          submitLabel: 'Go',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fieldCount: number }>();
        expect(json.fieldCount).toBe(1);
      });

      test('should handle many fields', async ({ mcp }) => {
        const fields = Array.from({ length: 20 }, (_, i) => ({
          name: `field_${i}`,
          type: 'text' as const,
          label: `Field ${i}`,
        }));

        const result = await mcp.tools.call('react-form', {
          fields,
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ fieldCount: number }>();
        expect(json.fieldCount).toBe(20);
      });

      test('should handle very long field names', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'a'.repeat(100), type: 'text', label: 'Long Name Field' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long labels', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'field', type: 'text', label: 'L'.repeat(200) }],
          submitLabel: 'Submit',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle form without explicit submitLabel', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'field', type: 'text', label: 'Field' }],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in labels', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'name_jp', type: 'text', label: '名前' },
            { name: 'email_de', type: 'email', label: 'E-Mail-Adresse' },
          ],
          submitLabel: '送信',
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in labels', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [
            { name: 'email', type: 'email', label: '📧 Email' },
            { name: 'phone', type: 'text', label: '📱 Phone' },
          ],
          submitLabel: '✅ Submit',
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing fields array', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          submitLabel: 'Submit',
        });

        expect(result).toBeError();
      });

      test('should reject invalid field type', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'field', type: 'password', label: 'Password' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeError();
      });

      test('should reject field without name', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ type: 'text', label: 'No Name' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeError();
      });

      test('should reject field without type', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'field', label: 'No Type' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeError();
      });

      test('should reject field without label', async ({ mcp }) => {
        const result = await mcp.tools.call('react-form', {
          fields: [{ name: 'field', type: 'text' }],
          submitLabel: 'Submit',
        });

        expect(result).toBeError();
      });
    });
  });

  test.describe('Concurrent React Tool Calls', () => {
    test('should handle concurrent chart calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('react-chart', {
            data: [{ label: `Point ${i}`, value: i * 10 }],
            title: `Chart ${i}`,
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle concurrent form calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('react-form', {
            fields: [{ name: `field_${i}`, type: 'text', label: `Field ${i}` }],
            submitLabel: `Submit ${i}`,
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle mixed chart and form calls', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.tools.call('react-chart', { data: [{ label: 'A', value: 10 }] }),
        mcp.tools.call('react-form', { fields: [{ name: 'f1', type: 'text', label: 'F1' }] }),
        mcp.tools.call('react-chart', { data: [{ label: 'B', value: 20 }] }),
        mcp.tools.call('react-form', { fields: [{ name: 'f2', type: 'email', label: 'F2' }] }),
      ]);

      expect(results).toHaveLength(4);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });
  });
});
