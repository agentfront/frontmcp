/**
 * E2E Tests for Markdown UI Tools
 *
 * Tests for markdown-report and markdown-list tools including:
 * - Basic functionality
 * - Severity levels
 * - Completion tracking
 * - Edge cases and boundaries
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Markdown Tools E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('Markdown Report Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate markdown report with findings', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Security Audit',
          summary: 'Overall security posture is good',
          findings: [
            { title: 'Missing HTTPS', description: 'Enable HTTPS', severity: 'high' },
            { title: 'Weak Password', description: 'Improve policy', severity: 'medium' },
          ],
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('markdown');
        expect(result).toHaveTextContent('findingCount');
      });

      test('should return correct finding count', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Multi-Finding Report',
          summary: 'Multiple findings test',
          findings: [
            { title: 'F1', description: 'Desc 1', severity: 'low' },
            { title: 'F2', description: 'Desc 2', severity: 'medium' },
            { title: 'F3', description: 'Desc 3', severity: 'high' },
            { title: 'F4', description: 'Desc 4', severity: 'low' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ findingCount: number }>();
        expect(json.findingCount).toBe(4);
      });

      test('should include title in output', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'My Report Title',
          summary: 'Summary text',
          findings: [{ title: 'Finding', description: 'Desc', severity: 'low' }],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ title: string }>();
        expect(json.title).toBe('My Report Title');
      });

      test('should generate markdown content', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'Summary here',
          findings: [{ title: 'Issue', description: 'Description', severity: 'medium' }],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ markdown: string }>();
        expect(json.markdown).toContain('Summary');
        expect(json.markdown).toContain('Issue');
      });
    });

    test.describe('Severity Levels', () => {
      test('should handle low severity', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Low Severity Report',
          summary: 'Minor issues',
          findings: [
            { title: 'Minor Issue 1', description: 'Not critical', severity: 'low' },
            { title: 'Minor Issue 2', description: 'Also not critical', severity: 'low' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ markdown: string }>();
        expect((json.markdown.match(/LOW/g) || []).length).toBe(2);
      });

      test('should handle medium severity', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Medium Severity Report',
          summary: 'Moderate issues',
          findings: [
            { title: 'Moderate Issue 1', description: 'Should fix', severity: 'medium' },
            { title: 'Moderate Issue 2', description: 'Should also fix', severity: 'medium' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ markdown: string }>();
        expect((json.markdown.match(/MEDIUM/g) || []).length).toBe(2);
      });

      test('should handle high severity', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Critical Report',
          summary: 'All critical issues',
          findings: [
            { title: 'Critical 1', description: 'Issue 1', severity: 'high' },
            { title: 'Critical 2', description: 'Issue 2', severity: 'high' },
            { title: 'Critical 3', description: 'Issue 3', severity: 'high' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ markdown: string }>();
        expect((json.markdown.match(/HIGH/g) || []).length).toBe(3);
      });

      test('should handle all severity levels together', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'All Severities',
          summary: 'Testing all severity levels',
          findings: [
            { title: 'Low Finding', description: 'Low severity issue', severity: 'low' },
            { title: 'Medium Finding', description: 'Medium severity issue', severity: 'medium' },
            { title: 'High Finding', description: 'High severity issue', severity: 'high' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ findingCount: number; markdown: string }>();
        expect(json.findingCount).toBe(3);
        expect(json.markdown).toContain('LOW');
        expect(json.markdown).toContain('MEDIUM');
        expect(json.markdown).toContain('HIGH');
      });

      test('should handle mixed severity distribution', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Mixed Report',
          summary: 'Various severities',
          findings: [
            { title: 'F1', description: 'D1', severity: 'high' },
            { title: 'F2', description: 'D2', severity: 'low' },
            { title: 'F3', description: 'D3', severity: 'high' },
            { title: 'F4', description: 'D4', severity: 'medium' },
            { title: 'F5', description: 'D5', severity: 'low' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ markdown: string }>();
        expect((json.markdown.match(/HIGH/g) || []).length).toBe(2);
        expect((json.markdown.match(/MEDIUM/g) || []).length).toBe(1);
        expect((json.markdown.match(/LOW/g) || []).length).toBe(2);
      });
    });

    test.describe('Edge Cases and Boundaries', () => {
      test('should handle empty findings array', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Empty Report',
          summary: 'No findings to report',
          findings: [],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ findingCount: number }>();
        expect(json.findingCount).toBe(0);
      });

      test('should handle single finding', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Single Finding',
          summary: 'Only one issue',
          findings: [{ title: 'Only Issue', description: 'The only one', severity: 'medium' }],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ findingCount: number }>();
        expect(json.findingCount).toBe(1);
      });

      test('should handle many findings', async ({ mcp }) => {
        const findings = Array.from({ length: 20 }, (_, i) => ({
          title: `Finding ${i + 1}`,
          description: `Description for finding ${i + 1}`,
          severity: (['low', 'medium', 'high'] as const)[i % 3],
        }));

        const result = await mcp.tools.call('markdown-report', {
          title: 'Large Report',
          summary: 'Many findings',
          findings,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ findingCount: number }>();
        expect(json.findingCount).toBe(20);
      });

      test('should handle very long title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'T'.repeat(300),
          summary: 'Summary',
          findings: [{ title: 'F', description: 'D', severity: 'low' }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long summary', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'S'.repeat(2000),
          findings: [{ title: 'F', description: 'D', severity: 'low' }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long finding descriptions', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'Summary',
          findings: [{ title: 'Finding', description: 'D'.repeat(5000), severity: 'medium' }],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'セキュリティレポート - 安全報告',
          summary: 'Security report summary',
          findings: [{ title: 'Issue', description: 'Desc', severity: 'low' }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle Unicode in findings', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'International Report',
          summary: 'Various languages',
          findings: [
            { title: '問題 1', description: '日本語の説明', severity: 'low' },
            { title: 'Проблема 2', description: 'Русское описание', severity: 'medium' },
            { title: 'בעיה 3', description: 'תיאור עברי', severity: 'high' },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in content', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: '🔒 Security Report',
          summary: '✅ Overall good, ⚠️ some issues',
          findings: [{ title: '🔴 Critical Bug', description: '❌ Needs fixing', severity: 'high' }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle markdown special characters', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report with *bold* and _italic_',
          summary: 'Summary with `code` and [links](http://example.com)',
          findings: [{ title: 'Finding with #hashtag', description: '- Item 1\n- Item 2', severity: 'medium' }],
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('markdown');
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          summary: 'Summary without title',
          findings: [{ title: 'F', description: 'D', severity: 'low' }],
        });

        expect(result).toBeError();
      });

      test('should reject missing summary', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Title without summary',
          findings: [{ title: 'F', description: 'D', severity: 'low' }],
        });

        expect(result).toBeError();
      });

      test('should reject missing findings', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Title',
          summary: 'Summary',
        });

        expect(result).toBeError();
      });

      test('should reject invalid severity', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Test',
          summary: 'Test summary',
          findings: [{ title: 'Finding', description: 'Desc', severity: 'invalid' }],
        });

        expect(result).toBeError();
      });

      test('should reject finding without title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'Summary',
          findings: [{ description: 'Desc without title', severity: 'low' }],
        });

        expect(result).toBeError();
      });

      test('should reject finding without description', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'Summary',
          findings: [{ title: 'Title without desc', severity: 'low' }],
        });

        expect(result).toBeError();
      });

      test('should reject finding without severity', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'Summary',
          findings: [{ title: 'Finding', description: 'Desc' }],
        });

        expect(result).toBeError();
      });
    });
  });

  test.describe('Markdown List Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate markdown list with items', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Todo List',
          items: [
            { text: 'Review PR', completed: true },
            { text: 'Write tests', completed: false },
            { text: 'Deploy', completed: false },
          ],
          ordered: true,
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('markdown');
        expect(result).toHaveTextContent('completedCount');
      });

      test('should count completed items correctly', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Progress List',
          items: [
            { text: 'Done 1', completed: true },
            { text: 'Done 2', completed: true },
            { text: 'Pending 1', completed: false },
            { text: 'Pending 2', completed: false },
            { text: 'Done 3', completed: true },
          ],
          ordered: false,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ completedCount: number }>();
        expect(json.completedCount).toBe(3);
      });

      test('should include title in output', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'My List Title',
          items: [{ text: 'Item', completed: false }],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ title: string }>();
        expect(json.title).toBe('My List Title');
      });
    });

    test.describe('List Types', () => {
      test('should handle ordered list', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Ordered Steps',
          items: [
            { text: 'Step 1', completed: true },
            { text: 'Step 2', completed: false },
            { text: 'Step 3', completed: false },
          ],
          ordered: true,
        });

        expect(result).toBeSuccessful();
      });

      test('should handle unordered list', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Unordered Tasks',
          items: [
            { text: 'Task A', completed: true },
            { text: 'Task B', completed: false },
          ],
          ordered: false,
        });

        expect(result).toBeSuccessful();
      });

      test('should default to unordered when not specified', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Default List',
          items: [{ text: 'Item', completed: false }],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Completion States', () => {
      test('should handle all completed', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'All Done',
          items: [
            { text: 'Task 1', completed: true },
            { text: 'Task 2', completed: true },
            { text: 'Task 3', completed: true },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ completedCount: number }>();
        expect(json.completedCount).toBe(3);
      });

      test('should handle none completed', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'All Pending',
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: false },
            { text: 'Task 3', completed: false },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ completedCount: number }>();
        expect(json.completedCount).toBe(0);
      });

      test('should handle mixed completion', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Mixed',
          items: [
            { text: 'Done', completed: true },
            { text: 'Pending', completed: false },
            { text: 'Done', completed: true },
            { text: 'Pending', completed: false },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ completedCount: number }>();
        expect(json.completedCount).toBe(2);
      });
    });

    test.describe('Edge Cases and Boundaries', () => {
      test('should handle empty items array', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Empty List',
          items: [],
          ordered: true,
        });

        expect(result).toBeSuccessful();
      });

      test('should handle single item', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Single Item',
          items: [{ text: 'Only item', completed: false }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle many items', async ({ mcp }) => {
        const items = Array.from({ length: 50 }, (_, i) => ({
          text: `Task ${i + 1}`,
          completed: i % 2 === 0,
        }));

        const result = await mcp.tools.call('markdown-list', {
          title: 'Large List',
          items,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ completedCount: number }>();
        expect(json.completedCount).toBe(25); // Even indices are completed
      });

      test('should handle very long item text', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Long Text',
          items: [{ text: 'T'.repeat(1000), completed: false }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'L'.repeat(500),
          items: [{ text: 'Item', completed: false }],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'タスクリスト - 任务列表',
          items: [{ text: 'Task', completed: false }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle Unicode in items', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'International Tasks',
          items: [
            { text: 'タスク 1', completed: true },
            { text: 'Aufgabe 2', completed: false },
            { text: 'Задача 3', completed: true },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in items', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: '📋 Task List',
          items: [
            { text: '✅ Completed task', completed: true },
            { text: '⏳ Pending task', completed: false },
            { text: '🔥 Urgent task', completed: false },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle special markdown characters', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'Special *chars* list',
          items: [
            { text: 'Item with `code`', completed: false },
            { text: 'Item with **bold**', completed: true },
            { text: 'Item with [link](url)', completed: false },
          ],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing title', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          items: [{ text: 'Item', completed: false }],
        });

        expect(result).toBeError();
      });

      test('should reject missing items', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'No Items List',
        });

        expect(result).toBeError();
      });

      test('should reject item without text', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'List',
          items: [{ completed: false }],
        });

        expect(result).toBeError();
      });

      test('should handle item without completed flag (defaults to uncompleted)', async ({ mcp }) => {
        const result = await mcp.tools.call('markdown-list', {
          title: 'List',
          items: [{ text: 'No completed flag' }],
        });

        // completed is optional, defaults to false/uncompleted
        expect(result).toBeSuccessful();
        const json = result.json<{ completedCount: number }>();
        expect(json.completedCount).toBe(0);
      });
    });
  });

  test.describe('Concurrent Markdown Tool Calls', () => {
    test('should handle concurrent report calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('markdown-report', {
            title: `Report ${i}`,
            summary: `Summary ${i}`,
            findings: [{ title: `F${i}`, description: `D${i}`, severity: 'low' }],
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle concurrent list calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('markdown-list', {
            title: `List ${i}`,
            items: [{ text: `Item ${i}`, completed: i % 2 === 0 }],
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle mixed markdown tool calls', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.tools.call('markdown-report', {
          title: 'Report',
          summary: 'Summary',
          findings: [{ title: 'F', description: 'D', severity: 'low' }],
        }),
        mcp.tools.call('markdown-list', {
          title: 'List',
          items: [{ text: 'Item', completed: true }],
        }),
        mcp.tools.call('markdown-report', {
          title: 'Report 2',
          summary: 'Summary 2',
          findings: [{ title: 'F2', description: 'D2', severity: 'high' }],
        }),
        mcp.tools.call('markdown-list', {
          title: 'List 2',
          items: [{ text: 'Item 2', completed: false }],
        }),
      ]);

      expect(results).toHaveLength(4);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });
  });
});
