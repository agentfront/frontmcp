/**
 * The browser bundle of a FrontMCP server that create() builds in a web page (#827): what an app's bundler ships
 * for `create()` + one tool, from the built packages and without the optional peers. A feature the SDK loads on
 * demand must stay out of it until the config asks for it.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import {
  bundleForBrowser,
  DEFAULT_CONFIG_MODULES,
  fixtureDir,
  importChain,
  inputSizes,
  leakedFeatures,
  OPTIONAL_PEERS,
  SERVER_MODULES,
  type BrowserBundle,
} from './helpers/browser-bundle';

const BUDGETS: Array<{ entry: string; label: string; maxBytes: number }> = [
  { entry: 'create-tool.ts', label: 'create() + one tool', maxBytes: 2_690_000 },
  { entry: 'create-webmcp-tool.ts', label: 'create() + WebMcpPlugin + one tool', maxBytes: 2_700_000 },
];

const VITE_INITIAL_CHUNK_MAX_BYTES = 1_180_000;

const sdkModule = (pattern: string) => new RegExp(`^libs/sdk/dist/browser/(${pattern})`);

const FEATURE_MODULES: Record<string, RegExp> = {
  agents: sdkModule('agent/(agent\\.instance|agent\\.scope|agent-execution-loop|flows/|adapters/)'),
  auth: sdkModule('auth/(flows|instances|auth-ui|cimd|credentials|secure-store)/|front-mcp/authorities-rules\\.check'),
  channels: sdkModule('channel/(?!channel\\.utils)'),
  'distributed transport': sdkModule('ha/|transport/(bus|relay|event-stores)/'),
  elicitation: sdkModule('elicitation/(store|flows)/|elicitation/send-elicitation-result\\.tool'),
  health: sdkModule('health/'),
  'http transport': sdkModule(
    'scope/flows/http\\.|transport/(flows/|adapters/|transport\\.registry|web-fetch-handler)|server/custom-routes\\.helper',
  ),
  'ipc transport': sdkModule('transport/ipc-server\\.transport'),
  jobs: sdkModule('job/(?!job\\.utils)|workflow/'),
  'mcp registry': sdkModule('mcp-registry/flows/'),
  metrics: sdkModule('metrics/'),
  observability: sdkModule('scope/(observability-scope\\.helper|tracer-provider\\.utils)'),
  'remote and esm entries': sdkModule('remote-mcp/|esm-loader/(?!package-specifier)'),
  skills:
    /^libs\/sdk\/dist\/browser\/skill\/(providers|session|sep-2640|flows|hooks)\/|\/node_modules\/(js-yaml|vectoriadb)\//,
  tasks: sdkModule(
    'task/(store/(?!task-backend\\.utils)|flows/|task\\.registry|helpers/(task-runner|cli-task-runner))',
  ),
  'tool ui':
    /^libs\/uipack\/dist\/esm\/(adapters|shell|bridge-runtime)\/|^libs\/sdk\/dist\/browser\/tool\/ui\/(ui-render|ui-resource\.handler|ui-option-warnings|ui-resource-template)\./,
};

// Only shrinks: a feature leaves this list in the change that keeps it out of the core path
const KNOWN_LEAKS: string[] = [
  'agents',
  'auth',
  'channels',
  'distributed transport',
  'health',
  'http transport',
  'metrics',
  'skills',
];

function topInputs(bundle: BrowserBundle, count = 15): string {
  return inputSizes(bundle.metafile)
    .slice(0, count)
    .map(([input, bytes]) => `  ${bytes.toLocaleString('en-US').padStart(10)}  ${input}`)
    .join('\n');
}

describe('the browser bundle of create()', () => {
  const bundles = new Map<string, BrowserBundle>();

  beforeAll(async () => {
    for (const { entry } of BUDGETS) {
      bundles.set(entry, await bundleForBrowser(resolve(fixtureDir, entry), DEFAULT_CONFIG_MODULES));
    }
  });

  it.each(BUDGETS)('keeps $label within its budget', ({ entry, label, maxBytes }) => {
    const bundle = bundles.get(entry) as BrowserBundle;
    process.stdout.write(
      `${label}: ${bundle.bytes.toLocaleString('en-US')} bytes minified, ${bundle.gzipBytes.toLocaleString('en-US')} gzipped (budget ${maxBytes.toLocaleString('en-US')})\n`,
    );
    if (bundle.bytes > maxBytes) {
      throw new Error(
        `${label} is ${bundle.bytes.toLocaleString('en-US')} bytes, over its ${maxBytes.toLocaleString('en-US')} budget. Largest inputs:\n${topInputs(bundle)}`,
      );
    }
  });

  it('reaches only the feature modules it is known to reach', async () => {
    const bundle = await bundleForBrowser(resolve(fixtureDir, 'create-tool.ts'), SERVER_MODULES);
    const leaks = leakedFeatures(bundle.metafile, FEATURE_MODULES);
    const unexpected = [...leaks.keys()].filter((feature) => !KNOWN_LEAKS.includes(feature)).sort();
    const importChains = Object.fromEntries(
      unexpected.map((feature) => [
        feature,
        importChain(bundle.metafile, bundle.entryInput, (leaks.get(feature) as string[])[0]),
      ]),
    );
    expect({ unexpected, importChains }).toEqual({ unexpected: [], importChains: {} });
    expect(KNOWN_LEAKS.filter((feature) => !leaks.has(feature))).toEqual([]);
  });

  it('keeps the initial chunk of a Vite app within its budget', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-bundle-size-'));
    try {
      const output = execFileSync(
        process.execPath,
        [
          resolve(__dirname, 'helpers/vite-initial-chunk.mjs'),
          resolve(fixtureDir, 'create-tool.ts'),
          outDir,
          resolve(fixtureDir, 'missing-peer.mjs'),
          ...OPTIONAL_PEERS,
        ],
        { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } },
      );
      const { initialBytes, totalBytes } = JSON.parse(output) as { initialBytes: number; totalBytes: number };
      process.stdout.write(
        `Vite, create() + one tool: initial chunk ${initialBytes.toLocaleString('en-US')} bytes, all chunks ${totalBytes.toLocaleString('en-US')} (budget ${VITE_INITIAL_CHUNK_MAX_BYTES.toLocaleString('en-US')})\n`,
      );
      expect(initialBytes).toBeLessThanOrEqual(VITE_INITIAL_CHUNK_MAX_BYTES);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
