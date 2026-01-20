import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z.object({
  query: z.string().describe('Search query for Mintlify documentation'),
});

const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

const outputSchema = z.object({
  results: z.array(resultSchema),
  query: z.string(),
  totalResults: z.number(),
});

type SearchInput = z.infer<typeof inputSchema>;
type SearchOutput = z.infer<typeof outputSchema>;

// Mock documentation database
const MOCK_DOCS = [
  {
    title: 'Getting Started with Mintlify',
    url: 'https://mintlify.com/docs/getting-started',
    snippet:
      'Learn how to set up and configure Mintlify for your documentation needs. This guide covers installation, basic configuration, and your first steps.',
    keywords: ['getting started', 'setup', 'install', 'begin', 'start'],
  },
  {
    title: 'API Documentation',
    url: 'https://mintlify.com/docs/api',
    snippet:
      'Complete API reference for Mintlify. Includes endpoints, authentication, and code examples for integrating with your applications.',
    keywords: ['api', 'documentation', 'reference', 'endpoint'],
  },
  {
    title: 'Components Reference',
    url: 'https://mintlify.com/docs/components',
    snippet:
      'Explore the available UI components for building beautiful documentation pages. Includes code blocks, callouts, tabs, and more.',
    keywords: ['components', 'ui', 'reference', 'elements'],
  },
  {
    title: 'Configuration Guide',
    url: 'https://mintlify.com/docs/configuration',
    snippet:
      'Detailed configuration options for customizing your Mintlify documentation site. Learn about themes, navigation, and advanced settings.',
    keywords: ['configuration', 'config', 'settings', 'customize'],
  },
];

@Tool({
  name: 'SearchMintlify',
  description: 'Search across the Mintlify knowledge base to find relevant information',
  inputSchema,
  outputSchema,
})
export default class SearchMintlifyTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: SearchInput): Promise<SearchOutput> {
    const query = input.query.toLowerCase();

    // Find matching docs based on keywords
    const matchingDocs = MOCK_DOCS.filter((doc) => doc.keywords.some((keyword) => query.includes(keyword)));

    // If no keyword matches, return the first doc as a fallback
    const results =
      matchingDocs.length > 0
        ? matchingDocs.map(({ title, url, snippet }) => ({ title, url, snippet }))
        : [{ title: MOCK_DOCS[0].title, url: MOCK_DOCS[0].url, snippet: MOCK_DOCS[0].snippet }];

    return {
      results,
      query: input.query,
      totalResults: results.length,
    };
  }
}
