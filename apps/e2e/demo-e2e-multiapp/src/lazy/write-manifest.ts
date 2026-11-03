/** Write the lazy apps server's frontmcp.manifest.json to the path given, as `frontmcp build` does. */
import { writeFile } from '@frontmcp/utils';

process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';

async function main(out: string): Promise<void> {
  const { buildManifest } = await import('@frontmcp/sdk');
  const { LazyAppsServer } = await import('./lazy.main.js');
  await writeFile(out, JSON.stringify(await buildManifest(LazyAppsServer), null, 2));
}

main(process.argv[2]).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
