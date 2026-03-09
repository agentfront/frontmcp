import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { resolveUISource } from '@frontmcp/uipack';
import type { UISource } from '@frontmcp/uipack';

const inputSchema = {
  sourceType: z.enum(['npm', 'import', 'function']).describe('Type of UI source'),
  packageName: z.string().optional().describe('NPM package name (for npm source)'),
  importUrl: z.string().optional().describe('Import URL (for import source)'),
  exportName: z.string().optional().describe('Export name override'),
};

const outputSchema = z.object({
  mode: z.string(),
  url: z.string().optional(),
  html: z.string().optional(),
  exportName: z.string(),
  peerDependencies: z.array(z.string()),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'load-component',
  description: 'Resolve a UI source (npm, import, or function) into a loadable component',
  inputSchema,
  outputSchema,
})
export default class LoadComponentTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    let source: UISource;

    switch (input.sourceType) {
      case 'npm':
        if (!input.packageName) {
          throw new Error('packageName is required for npm source');
        }
        source = { npm: input.packageName, exportName: input.exportName };
        break;
      case 'import':
        if (!input.importUrl) {
          throw new Error('importUrl is required for import source');
        }
        source = { import: input.importUrl, exportName: input.exportName };
        break;
      case 'function':
        source = (_input: unknown, _output: unknown) => '<div>Function component rendered</div>';
        break;
      default:
        throw new Error(`Unknown source type: ${input.sourceType}`);
    }

    const resolved = resolveUISource(source);

    return {
      mode: resolved.mode,
      url: resolved.url,
      html: resolved.html,
      exportName: resolved.exportName,
      peerDependencies: resolved.peerDependencies,
    };
  }
}
