import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { build, type Metafile, type Plugin } from 'esbuild';

import { realpath } from '@frontmcp/utils';

export const workspaceRoot = resolve(__dirname, '../../../../..');
export const fixtureDir = resolve(__dirname, '../../fixture');
export const OPTIONAL_PEERS = ['openai', '@anthropic-ai/sdk', '@vercel/kv', '@upstash/redis', '@enclave-vm/core'];

// The modules create() loads with import() whatever the config asks for
const CORE_LAZY_MODULES = new Set(['front-mcp/front-mcp.mjs']);
const nodeBuiltins = new Set(builtinModules);

export interface BrowserBundle {
  bytes: number;
  gzipBytes: number;
  entryInput: string;
  metafile: Metafile;
}

function keepOnDemandModulesOut(sdkBrowserDist: string): Plugin {
  return {
    name: 'keep-on-demand-modules-out',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^\./ }, (args) => {
        if (args.kind !== 'dynamic-import' || !args.importer.startsWith(sdkBrowserDist)) return undefined;
        const target = relative(sdkBrowserDist, resolve(dirname(args.importer), args.path));
        return CORE_LAZY_MODULES.has(target) ? undefined : { path: args.path, external: true };
      });
    },
  };
}

const stubNodeBuiltins: Plugin = {
  name: 'stub-node-builtins',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[a-z_:/]+$/ }, (args) =>
      args.path.startsWith('node:') || nodeBuiltins.has(args.path)
        ? { path: args.path, namespace: 'node-builtin' }
        : undefined,
    );
    pluginBuild.onLoad({ filter: /.*/, namespace: 'node-builtin' }, () => ({ contents: 'module.exports = {};' }));
  },
};

const stubOptionalPeers: Plugin = {
  name: 'stub-optional-peers',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) =>
      OPTIONAL_PEERS.some((peer) => args.path === peer || args.path.startsWith(`${peer}/`))
        ? { path: args.path, namespace: 'missing-peer' }
        : undefined,
    );
    pluginBuild.onLoad({ filter: /.*/, namespace: 'missing-peer' }, (args) => ({
      contents: `throw new Error(${JSON.stringify(`${args.path} is not installed`)});`,
    }));
  },
};

/** What an app's browser bundle of the entry loads up to create(), from the built packages, without optional peers. */
export async function bundleForBrowser(entryFile: string): Promise<BrowserBundle> {
  const sdkBrowserDist = await realpath(resolve(workspaceRoot, 'libs/sdk/dist/browser'));
  const result = await build({
    entryPoints: [entryFile],
    absWorkingDir: workspaceRoot,
    outdir: resolve(workspaceRoot, 'dist/bundle-size'),
    bundle: true,
    write: false,
    metafile: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    conditions: ['browser'],
    tsconfigRaw: {},
    logLevel: 'silent',
    plugins: [keepOnDemandModulesOut(sdkBrowserDist), stubNodeBuiltins, stubOptionalPeers],
  });
  const output = result.outputFiles.find((file) => file.path.endsWith('.js'));
  if (!output) throw new Error(`esbuild emitted no JavaScript for ${entryFile}`);
  return {
    bytes: output.contents.byteLength,
    gzipBytes: gzipSync(output.contents).byteLength,
    entryInput: relative(workspaceRoot, entryFile),
    metafile: result.metafile,
  };
}

/** The bytes each input contributes to the bundle, largest first. */
export function inputSizes(metafile: Metafile): Array<[input: string, bytes: number]> {
  const sizes = new Map<string, number>();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      if (bytesInOutput > 0) sizes.set(input, (sizes.get(input) ?? 0) + bytesInOutput);
    }
  }
  return [...sizes.entries()].sort((a, b) => b[1] - a[1]);
}

/** The inputs of each feature that made it into the bundle, by feature name. */
export function leakedFeatures(metafile: Metafile, features: Record<string, RegExp>): Map<string, string[]> {
  const leaks = new Map<string, string[]>();
  for (const [input] of inputSizes(metafile)) {
    for (const [feature, pattern] of Object.entries(features)) {
      if (pattern.test(input)) leaks.set(feature, [...(leaks.get(feature) ?? []), input]);
    }
  }
  return leaks;
}

/** The shortest chain of imports from the entry to an input through modules in the bundle, naming the import that caused a leak. */
export function importChain(metafile: Metafile, entryInput: string, target: string): string[] {
  const bundled = new Set(inputSizes(metafile).map(([input]) => input));
  const importedBy = new Map<string, string>([[entryInput, '']]);
  const queue = [entryInput];
  while (queue.length > 0 && !importedBy.has(target)) {
    const current = queue.shift() as string;
    for (const imported of metafile.inputs[current]?.imports ?? []) {
      if (imported.external || importedBy.has(imported.path) || !bundled.has(imported.path)) continue;
      importedBy.set(imported.path, current);
      queue.push(imported.path);
    }
  }
  const chain: string[] = [];
  for (let input = target; input; input = importedBy.get(input) ?? '') chain.unshift(input);
  return chain;
}
