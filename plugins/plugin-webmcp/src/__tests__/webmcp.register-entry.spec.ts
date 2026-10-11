import { build } from 'esbuild';

import { FakeModelContext } from './helpers/fake-model-context';

/**
 * `@frontmcp/plugin-webmcp/register` runs in the page before the server is loaded, so its module
 * graph must stay small and never reach the SDK.
 */
describe('the register entry', () => {
  it('bundles without @frontmcp/sdk, @frontmcp/utils or zod, in a few kilobytes', async () => {
    const result = await build({
      entryPoints: [require.resolve('../register')],
      bundle: true,
      write: false,
      metafile: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      logLevel: 'silent',
    });

    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.filter((input) => !input.includes('plugins/plugin-webmcp/src/'))).toEqual([]);
    expect(result.outputFiles[0].contents.byteLength).toBeLessThan(6 * 1024);
  });

  it('registers the listed tools without loading the server or the SDK', async () => {
    const modelContext = new FakeModelContext();
    const loadServer = jest.fn();

    await jest.isolateModulesAsync(async () => {
      for (const moduleName of ['@frontmcp/sdk', '@frontmcp/utils', '@frontmcp/lazy-zod']) {
        jest.doMock(moduleName, () => {
          throw new Error(`${moduleName} was loaded`);
        });
      }
      const { isWebMcpSupported, registerWebMcpTools, resolveDocumentModelContext } = await import('../register');
      expect([isWebMcpSupported(), resolveDocumentModelContext()]).toEqual([false, undefined]);
      await registerWebMcpTools(
        modelContext,
        [{ name: 'shop.checkout', description: 'Place the order', inputSchema: { type: 'object' } }],
        loadServer,
      );
    });

    expect(modelContext.names()).toEqual(['shop.checkout']);
    expect(loadServer).not.toHaveBeenCalled();
  });
});
