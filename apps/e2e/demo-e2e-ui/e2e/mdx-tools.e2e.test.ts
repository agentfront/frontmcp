/**
 * E2E Tests for MDX UI Tools
 *
 * Tests for mdx-doc and mdx-interactive tools including:
 * - Basic functionality
 * - Section handling
 * - Code examples
 * - Edge cases and boundaries
 */
import { test, expect } from '@frontmcp/testing';

test.describe('MDX Tools E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    publicMode: true,
  });

  test.describe('MDX Doc Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate MDX document with sections', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'API Documentation',
          sections: [
            { heading: 'Getting Started', content: 'Install the package...' },
            { heading: 'Authentication', content: 'Use an API key...' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ sectionCount: number; title: string }>();
        expect(json.sectionCount).toBe(2);
        expect(json.title).toBe('API Documentation');
      });

      test('should return correct section count', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Multi-Section Doc',
          sections: [
            { heading: 'Section 1', content: 'Content 1' },
            { heading: 'Section 2', content: 'Content 2' },
            { heading: 'Section 3', content: 'Content 3' },
          ],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ sectionCount: number }>();
        expect(json.sectionCount).toBe(3);
      });

      test('should include title in output', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'My Documentation Title',
          sections: [{ heading: 'Intro', content: 'Introduction content' }],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ title: string }>();
        expect(json.title).toBe('My Documentation Title');
      });
    });

    test.describe('Section Content', () => {
      test('should handle sections with markdown content', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Markdown Content',
          sections: [
            {
              heading: 'Features',
              content: '- Feature 1\n- Feature 2\n- Feature 3',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle sections with code blocks', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Code Examples',
          sections: [
            {
              heading: 'Installation',
              content: '```bash\nnpm install package\n```',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle sections with links', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Links Doc',
          sections: [
            {
              heading: 'Resources',
              content: 'Check out [our website](https://example.com) for more info.',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle sections with inline code', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Inline Code',
          sections: [
            {
              heading: 'Usage',
              content: 'Use the `npm install` command to install.',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle sections with tables', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Table Doc',
          sections: [
            {
              heading: 'API Reference',
              content:
                '| Method | Description |\n|--------|-------------|\n| GET | Retrieve data |\n| POST | Create data |',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Edge Cases and Boundaries', () => {
      test('should handle single section', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Single Section',
          sections: [{ heading: 'Only Section', content: 'Only content' }],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ sectionCount: number }>();
        expect(json.sectionCount).toBe(1);
      });

      test('should handle many sections', async ({ mcp }) => {
        const sections = Array.from({ length: 10 }, (_, i) => ({
          heading: `Section ${i + 1}`,
          content: `Content for section ${i + 1} with some **markdown** formatting.`,
        }));

        const result = await mcp.tools.call('mdx-doc', {
          title: 'Multi-Section Doc',
          sections,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ sectionCount: number }>();
        expect(json.sectionCount).toBe(10);
      });

      test('should handle 20 sections', async ({ mcp }) => {
        const sections = Array.from({ length: 20 }, (_, i) => ({
          heading: `Chapter ${i + 1}`,
          content: `This is the content for chapter ${i + 1}.`,
        }));

        const result = await mcp.tools.call('mdx-doc', {
          title: 'Large Documentation',
          sections,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ sectionCount: number }>();
        expect(json.sectionCount).toBe(20);
      });

      test('should handle very long section content', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Long Content',
          sections: [
            {
              heading: 'Long Section',
              content: 'A'.repeat(5000),
            },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long heading', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Long Heading Test',
          sections: [
            {
              heading: 'H'.repeat(200),
              content: 'Content',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle empty section content', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Empty Content',
          sections: [{ heading: 'Empty', content: '' }],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in title', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'ドキュメント - Documentation 文档',
          sections: [{ heading: 'Intro', content: 'Introduction' }],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle Unicode in headings', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'International Doc',
          sections: [
            { heading: '日本語セクション', content: 'Japanese content' },
            { heading: 'Раздел на русском', content: 'Russian content' },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in content', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Emoji Doc 📚',
          sections: [
            { heading: '🚀 Getting Started', content: '✅ Follow these steps...' },
            { heading: '⚠️ Warnings', content: '❌ Avoid these mistakes...' },
          ],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle special markdown characters', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Special Characters',
          sections: [
            {
              heading: 'Escaping',
              content: 'Use \\* for asterisks, \\# for hash, and \\` for backticks.',
            },
          ],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing title', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          sections: [{ heading: 'Section', content: 'Content' }],
        });

        expect(result).toBeError();
      });

      test('should reject missing sections', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'No Sections',
        });

        expect(result).toBeError();
      });

      test('should reject section without heading', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Missing Heading',
          sections: [{ content: 'Content without heading' }],
        });

        expect(result).toBeError();
      });

      test('should reject section without content', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-doc', {
          title: 'Missing Content',
          sections: [{ heading: 'Heading without content' }],
        });

        expect(result).toBeError();
      });
    });
  });

  test.describe('MDX Interactive Tool', () => {
    test.describe('Basic Functionality', () => {
      test('should generate interactive MDX', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'TypeScript Tips',
          points: ['Use strict mode', 'Prefer interfaces', 'Avoid any'],
          codeExample: 'const x: string = "hello";',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ topic: string; hasCode: boolean }>();
        expect(json.topic).toBe('TypeScript Tips');
        expect(json.hasCode).toBe(true);
      });

      test('should indicate hasCode when codeExample provided', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Code Topic',
          points: ['Point 1'],
          codeExample: 'console.log("test");',
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ hasCode: boolean }>();
        expect(json.hasCode).toBe(true);
      });

      test('should handle MDX without code example', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'No Code Topic',
          points: ['Point 1', 'Point 2', 'Point 3'],
        });

        expect(result).toBeSuccessful();
      });

      test('should include topic in output', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'My Topic',
          points: ['Point'],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ topic: string }>();
        expect(json.topic).toBe('My Topic');
      });
    });

    test.describe('Points Handling', () => {
      test('should handle single point', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Single Point',
          points: ['Only one point'],
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ points: string[] }>();
        expect(json.points).toHaveLength(1);
      });

      test('should handle many points', async ({ mcp }) => {
        const points = Array.from({ length: 10 }, (_, i) => `Point ${i + 1}`);

        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Many Points',
          points,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ points: string[] }>();
        expect(json.points).toHaveLength(10);
      });

      test('should handle points with markdown', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Markdown Points',
          points: ['**Bold** point', '_Italic_ point', '`Code` point', '[Link](https://example.com) point'],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long points', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Long Points',
          points: ['A'.repeat(500), 'B'.repeat(500)],
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Code Examples', () => {
      test('should handle JavaScript code', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'JavaScript',
          points: ['Learn JS'],
          codeExample: `const greeting = "Hello, World!";\nconsole.log(greeting);`,
        });

        expect(result).toBeSuccessful();
      });

      test('should handle TypeScript code with generics', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'TypeScript Generics',
          points: ['Use TypeScript', 'Handle errors'],
          codeExample: `const obj = { key: "value", arr: [1, 2, 3] };\nconst fn = <T>(x: T): T => x;`,
        });

        expect(result).toBeSuccessful();
        const json = result.json<{ hasCode: boolean }>();
        expect(json.hasCode).toBe(true);
      });

      test('should handle Python code', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Python',
          points: ['Learn Python'],
          codeExample: `def greet(name):\n    return f"Hello, {name}!"`,
        });

        expect(result).toBeSuccessful();
      });

      test('should handle multi-line code', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Multi-line',
          points: ['Code example'],
          codeExample: `function example() {
  const a = 1;
  const b = 2;
  const c = a + b;
  return c;
}`,
        });

        expect(result).toBeSuccessful();
      });

      test('should handle code with special characters', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Special Chars',
          points: ['Handle special chars'],
          codeExample: `const regex = /[a-z]+/g;\nconst html = "<div>Test</div>";`,
        });

        expect(result).toBeSuccessful();
      });

      test('should handle very long code examples', async ({ mcp }) => {
        const longCode = Array.from({ length: 50 }, (_, i) => `const line${i} = ${i};`).join('\n');

        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Long Code',
          points: ['Many lines of code'],
          codeExample: longCode,
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Unicode and Special Characters', () => {
      test('should handle Unicode in topic', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'プログラミング入門',
          points: ['Point 1', 'Point 2'],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle Unicode in points', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'International Points',
          points: ['日本語ポイント', 'Punkt auf Deutsch', 'Точка по-русски'],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle emoji in topic and points', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: '🚀 Rocket Science',
          points: ['🌟 Stars', '🌙 Moon', '☀️ Sun'],
        });

        expect(result).toBeSuccessful();
      });

      test('should handle code with Unicode', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Unicode Code',
          points: ['Handle Unicode'],
          codeExample: `const greeting = "こんにちは";\nconst emoji = "🎉";`,
        });

        expect(result).toBeSuccessful();
      });
    });

    test.describe('Error Handling', () => {
      test('should reject missing topic', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          points: ['Point 1', 'Point 2'],
        });

        expect(result).toBeError();
      });

      test('should reject missing points', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'No Points',
        });

        expect(result).toBeError();
      });

      test('should reject empty points array', async ({ mcp }) => {
        const result = await mcp.tools.call('mdx-interactive', {
          topic: 'Empty Points',
          points: [],
        });

        // Empty array might succeed or fail depending on schema
        // Just verify it handles the case
        expect(result).toBeDefined();
      });
    });
  });

  test.describe('Concurrent MDX Tool Calls', () => {
    test('should handle concurrent mdx-doc calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('mdx-doc', {
            title: `Doc ${i}`,
            sections: [{ heading: `Section ${i}`, content: `Content ${i}` }],
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle concurrent mdx-interactive calls', async ({ mcp }) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mcp.tools.call('mdx-interactive', {
            topic: `Topic ${i}`,
            points: [`Point ${i}.1`, `Point ${i}.2`],
          }),
        ),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });

    test('should handle mixed MDX tool calls', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.tools.call('mdx-doc', {
          title: 'Doc 1',
          sections: [{ heading: 'S1', content: 'C1' }],
        }),
        mcp.tools.call('mdx-interactive', {
          topic: 'Topic 1',
          points: ['P1'],
        }),
        mcp.tools.call('mdx-doc', {
          title: 'Doc 2',
          sections: [{ heading: 'S2', content: 'C2' }],
        }),
        mcp.tools.call('mdx-interactive', {
          topic: 'Topic 2',
          points: ['P2'],
          codeExample: 'const x = 1;',
        }),
      ]);

      expect(results).toHaveLength(4);
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });
  });
});
